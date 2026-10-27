import { AsyncLocalStorage } from "node:async_hooks";
import type { Api } from "grammy";
import type { Message } from "grammy/types";
import type { BotContext } from "../bot/context";
import { DEFAULT_LOCALE, type Locale, type Translator } from "../bot/i18n";
import { isIgnorableDeleteError } from "../bot/telegram-errors";
import type { Db } from "../db/client";
import {
  createSession,
  deleteSessionMessages,
  type EndedStatus,
  endSession,
  findActiveSession,
  getSession,
  listSessionMessages,
  type SessionKind,
  type SessionSummary,
  trackMessage,
} from "../db/repositories/sessions";
import { getSettings, getUserById } from "../db/repositories/users";
import type { LearningSession } from "../db/schema";
import type { HubService, HubUser } from "../hub/hub-service";
import type { Logger } from "../log";
import { arrivedWhileHeld, MemorySessionLocks, type SessionLocks } from "./locks";
import { type SessionWindow, SessionWindows } from "./window";

/** Schedules the inactivity timeout of a session. Implemented by BullMQ in production. */
export interface SessionTimeouts {
  /** (Re)starts the countdown for a session; an earlier countdown for it is dropped. */
  schedule(sessionId: number): Promise<void>;
  cancel(sessionId: number): Promise<void>;
}

type SendOptions = Parameters<Api["sendMessage"]>[2];

/** The active learning session as handlers see it: `ctx.learning`. */
export interface LearningHandle {
  readonly session: LearningSession;
  readonly user: HubUser;
  /** The user's UI language, for texts the session sends. */
  readonly locale: Locale;
  /**
   * The session's one window: steps are shown with `window.show`, hints with `window.flashNote`.
   * Prefer it to `send`, which adds a message that stays until the session ends.
   */
  readonly window: SessionWindow;
  /** Sends a message into the session's chat and tracks it for cleanup. */
  send(text: string, options?: SendOptions): Promise<Message.TextMessage>;
  /** Alias of `send`; sessions run in the private chat, so a reply is a send. */
  reply(text: string, options?: SendOptions): Promise<Message.TextMessage>;
  /**
   * Tracks a message sent some other way (a voice note…) as part of the step on screen: it is
   * deleted when the window shows the next step.
   */
  track(messageId: number): Promise<void>;
  /**
   * Runs `task` while no other answer of this session is being graded or the next item prepared.
   * Returns false, without running it, when one is: the caller tells the learner to wait.
   */
  withLock(task: () => Promise<void>): Promise<boolean>;
  end(status: EndedStatus, summary?: SessionSummary | null): Promise<boolean>;
}

/** What a session kind does. Feature slots register one per `session_kind`. */
export interface SessionKindHandler {
  /**
   * The session was just created. `ctx` is the update that started it (a hub button, a command),
   * so the handler can keep flow state in `ctx.session`; it is absent when a session starts
   * outside an update (a scheduled routine).
   */
  onStart(session: LearningHandle, ctx?: BotContext): Promise<void>;
  /**
   * A user message inside the session. The message is already tracked, and deleted once this
   * returns unless `keepsLearnerMessages` is set.
   */
  onMessage?(session: LearningHandle, ctx: BotContext): Promise<void>;
  /** The learner's messages are the session's content (a chat): the kind prunes them itself. */
  keepsLearnerMessages?: boolean;
}

export interface SessionManagerDeps {
  api: Api;
  db: Db;
  hub: HubService;
  timeouts: SessionTimeouts;
  log: Logger;
  i18n: Translator;
  /** How long flash notes stay on screen; defaults to `NOTE_TTL_MS`. */
  noteTtlMs?: number;
  /** The in-flight answer locks; in memory unless Redis is passed. */
  locks?: SessionLocks;
}

/** Summary line for a session that ended without one. A finished session supplies its own. */
const DEFAULT_SUMMARY_KEY: Record<EndedStatus, string | undefined> = {
  finished: undefined,
  cancelled: "session-cancelled",
  expired: "session-expired",
};

export type StartOutcome =
  | { started: true; handle: LearningHandle }
  | { started: false; active: LearningSession };

/** A session that just ended, for modules that react to finished work (the daily goal). */
export interface SessionEnded {
  session: LearningSession;
  user: HubUser;
  status: EndedStatus;
}

export type SessionEndedListener = (event: SessionEnded) => void | Promise<void>;

/** The parts of a sequence still to run after the current one, and the summaries so far. */
interface Sequence {
  rest: readonly SessionKind[];
  lines: readonly string[];
}

/** Telegram's deleteMessages takes at most 100 IDs per call. */
const DELETE_BATCH = 100;

export class SessionManager {
  private readonly handlers = new Map<SessionKind, SessionKindHandler>();
  private readonly update = new AsyncLocalStorage<BotContext>();
  /**
   * Running sequences by the ID of their current part. In memory: after a restart the rest of a
   * sequence is dropped and the learner lands on the hub, which is safe.
   */
  private readonly sequences = new Map<number, Sequence>();
  private readonly endedListeners = new Set<SessionEndedListener>();
  private readonly windows: SessionWindows;
  private readonly locks: SessionLocks;

  constructor(private readonly deps: SessionManagerDeps) {
    this.windows = new SessionWindows({ api: deps.api, log: deps.log, noteTtlMs: deps.noteTtlMs });
    this.locks = deps.locks ?? new MemorySessionLocks();
  }

  /**
   * Runs `task` holding the lock of `key`, released however `task` ends; false, without running
   * it, when the lock is held. The lock expires on its own if this process dies holding it.
   *
   * `openedAt` is when the update asking began. An update that began while the lock was held
   * (webhooks run updates side by side) read its flow state before that hold wrote it, so it is
   * refused as well, even when it gets to the lock after the release.
   */
  async withLock(key: string, task: () => Promise<void>, openedAt?: number): Promise<boolean> {
    const lease = await this.locks.acquire(key);
    if (!lease) return false;
    if (openedAt !== undefined && ((await this.locks.lastHeld(key))?.to ?? -1) > openedAt) {
      await lease.release({ record: false });
      return false;
    }
    try {
      await task();
    } finally {
      await lease.release().catch((error: unknown) => {
        this.deps.log.warn("session lock release failed", { key, error });
      });
    }
    return true;
  }

  /**
   * True when a message Telegram dated `dateSeconds` was sent while `key` was last held. Polling
   * handles updates one at a time, so such a message is only read after the lock is released:
   * it was typed while the previous answer was being handled, and is dropped like a concurrent one.
   */
  async queuedBehind(key: string, dateSeconds: number): Promise<boolean> {
    return arrivedWhileHeld(dateSeconds, await this.locks.lastHeld(key));
  }

  /** Deletes every live flash note now instead of after its delay (tests, shutdown). */
  flushNotes(): Promise<void> {
    return this.windows.flushNotes();
  }

  register(kind: SessionKind, handler: SessionKindHandler): void {
    if (this.handlers.has(kind)) throw new Error(`a handler for "${kind}" is already registered`);
    this.handlers.set(kind, handler);
  }

  handlerFor(kind: SessionKind): SessionKindHandler | undefined {
    return this.handlers.get(kind);
  }

  findActive(userId: number): Promise<LearningSession | undefined> {
    return findActiveSession(this.deps.db, userId);
  }

  /**
   * Runs `task` as the handling of `ctx`'s update, so a session started inside it hands that
   * update to `onStart` without every caller passing it along. Set by `sessionMiddleware`.
   */
  inUpdate<T>(ctx: BotContext, task: () => Promise<T>): Promise<T> {
    return this.update.run(ctx, task);
  }

  /**
   * Starts a session of `kind` unless the user already has an active one, in which case nothing
   * changes and the active session is returned so the caller can offer to cancel it. `ctx`
   * defaults to the update being handled, when it is this user's.
   */
  start(user: HubUser, kind: SessionKind, ctx?: BotContext): Promise<StartOutcome> {
    return this.begin(user, kind, ctx);
  }

  /**
   * Starts `kinds` one after another as separate sessions (a routine set): when a part finishes,
   * its messages are cleaned up and the next part starts in the same update instead of the hub
   * coming back. A part that is cancelled or expires ends the whole sequence. The hub then shows
   * the summaries of every part, joined. The outcome is that of the first part.
   */
  startSequence(
    user: HubUser,
    kinds: readonly [SessionKind, ...SessionKind[]],
    ctx?: BotContext,
  ): Promise<StartOutcome> {
    const [first, ...rest] = kinds;
    return this.begin(user, first, ctx, { rest, lines: [] });
  }

  /**
   * Makes an already started session the first part of a sequence, for a session another module
   * starts its own way (seeded grammar). No effect when the session is no longer active.
   */
  async continueWith(sessionId: number, kinds: readonly SessionKind[]): Promise<void> {
    const session = await getSession(this.deps.db, sessionId);
    if (session?.status !== "active" || this.sequences.has(sessionId)) return;
    this.sequences.set(sessionId, { rest: kinds, lines: [] });
  }

  /** Subscribes to every session end; returns the unsubscribe function. */
  onEnded(listener: SessionEndedListener): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  private async begin(
    user: HubUser,
    kind: SessionKind,
    ctx?: BotContext,
    sequence?: Sequence,
  ): Promise<StartOutcome> {
    const handler = this.handlers.get(kind);
    if (!handler) throw new Error(`no handler registered for session kind "${kind}"`);

    const result = await createSession(this.deps.db, user.id, kind);
    if (!result.created) return { started: false, active: result.active };

    // Before onStart: a part with nothing to do ends inside it, and must find its sequence.
    if (sequence) this.sequences.set(result.session.id, sequence);
    await this.deps.timeouts.schedule(result.session.id);
    const settings = await getSettings(this.deps.db, user.id);
    const current = ctx ?? this.update.getStore();
    const own = current?.user.id === user.id ? current : undefined;
    const handle = this.handle(result.session, user, settings?.uiLang ?? DEFAULT_LOCALE, own);
    await handler.onStart(handle, own);
    return { started: true, handle };
  }

  /**
   * The handle of an active session. `ctx` is the user's update being handled, if any: the window
   * keeps a copy of its state in its grammY session so a restart edits instead of stacking.
   */
  handle(
    session: LearningSession,
    user: HubUser,
    locale: Locale,
    ctx?: BotContext,
  ): LearningHandle {
    const openedAt = Date.now();
    const send = async (text: string, options?: SendOptions) => {
      const message = await this.deps.api.sendMessage(user.telegramId, text, options);
      await trackMessage(this.deps.db, session.id, message.chat.id, message.message_id);
      return message;
    };
    const window = this.windows.open(
      session.id,
      user.telegramId,
      (messageId) => trackMessage(this.deps.db, session.id, user.telegramId, messageId),
      ctx,
    );
    return {
      session,
      user,
      locale,
      window,
      send,
      reply: send,
      track: (messageId) => window.attach(messageId),
      withLock: (task) => this.withLock(sessionLockKey(session.id), task, openedAt),
      end: (status, summary) => this.end(session.id, status, summary),
    };
  }

  /** Records an incoming user message and restarts the inactivity countdown. */
  async recordIncoming(session: LearningSession, chatId: number, messageId: number) {
    await trackMessage(this.deps.db, session.id, chatId, messageId);
    await this.deps.timeouts.schedule(session.id);
  }

  /**
   * Ends a session: deletes every tracked message, stores the summary and re-sends the hub with
   * it — or, for a finished part of a sequence, starts the next part. Returns false (and does
   * nothing) when the session was not active any more.
   */
  async end(
    sessionId: number,
    status: EndedStatus,
    summary: SessionSummary | null = null,
  ): Promise<boolean> {
    const { db, hub, timeouts, log } = this.deps;
    const session = await getSession(db, sessionId);
    const user = session && (await getUserById(db, session.userId));
    if (!session || !user) return false;

    const sequence = this.sequences.get(sessionId);
    const next = status === "finished" ? sequence?.rest[0] : undefined;
    const own = summary ?? (await this.defaultSummary(user, status));
    // The last part (or the one that stopped the sequence) carries every part's line to the hub.
    const stored = sequence && !next ? joinSummaries(sequence.lines, own) : own;

    const ended = await endSession(db, sessionId, status, stored);
    if (!ended) return false;
    this.sequences.delete(sessionId);
    this.windows.forget(sessionId);

    await timeouts.cancel(sessionId).catch((error: unknown) => {
      log.warn("session timeout cancel failed", { sessionId, error });
    });
    await this.deleteTracked(sessionId);
    await this.notifyEnded({ session: ended, user, status });

    if (sequence && next) {
      const lines = own?.line ? [...sequence.lines, own.line] : sequence.lines;
      const outcome = await this.begin(user, next, undefined, {
        rest: sequence.rest.slice(1),
        lines,
      });
      if (outcome.started) return true;
    }
    await hub.bump(user);
    return true;
  }

  private async notifyEnded(event: SessionEnded): Promise<void> {
    for (const listener of this.endedListeners) {
      try {
        await listener(event);
      } catch (error) {
        this.deps.log.warn("session ended listener failed", {
          sessionId: event.session.id,
          error,
        });
      }
    }
  }

  /** Called by the inactivity timeout. */
  expire(sessionId: number): Promise<boolean> {
    return this.end(sessionId, "expired");
  }

  private async defaultSummary(user: HubUser, status: EndedStatus) {
    const key = DEFAULT_SUMMARY_KEY[status];
    if (!key) return null;
    const settings = await getSettings(this.deps.db, user.id);
    return { line: this.deps.i18n.t(settings?.uiLang ?? DEFAULT_LOCALE, key) };
  }

  private async deleteTracked(sessionId: number): Promise<void> {
    const { api, db, log } = this.deps;
    const messages = await listSessionMessages(db, sessionId);
    const byChat = new Map<number, number[]>();
    for (const { chatId, messageId } of messages) {
      byChat.set(chatId, [...(byChat.get(chatId) ?? []), messageId]);
    }

    for (const [chatId, ids] of byChat) {
      for (let i = 0; i < ids.length; i += DELETE_BATCH) {
        const batch = ids.slice(i, i + DELETE_BATCH);
        // deleteMessages skips messages that are gone or too old (>48h); a failure of the whole
        // call is logged, not rethrown, so the hub still comes back.
        await api.deleteMessages(chatId, batch).catch((error: unknown) => {
          if (!isIgnorableDeleteError(error)) {
            log.warn("session message cleanup failed", { sessionId, chatId, error });
          }
        });
      }
    }
    await deleteSessionMessages(db, sessionId);
  }
}

/** The lock a session's answers take: one is handled at a time. */
export const sessionLockKey = (sessionId: number) => `session:${sessionId}`;

/** One summary for a whole sequence: earlier parts' lines, then this part's, one per line. */
function joinSummaries(
  lines: readonly string[],
  own: SessionSummary | null,
): SessionSummary | null {
  if (!lines.length) return own;
  const all = own?.line ? [...lines, own.line] : lines;
  return { ...own, line: all.join("\n") };
}
