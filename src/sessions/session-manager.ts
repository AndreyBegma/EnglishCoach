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
  /** Sends a message into the session's chat and tracks it for cleanup. */
  send(text: string, options?: SendOptions): Promise<Message.TextMessage>;
  /** Alias of `send`; sessions run in the private chat, so a reply is a send. */
  reply(text: string, options?: SendOptions): Promise<Message.TextMessage>;
  /** Tracks a message that was sent some other way (a photo, a voice note…). */
  track(messageId: number): Promise<void>;
  end(status: EndedStatus, summary?: SessionSummary | null): Promise<boolean>;
}

/** What a session kind does. Feature slots register one per `session_kind`. */
export interface SessionKindHandler {
  onStart(session: LearningHandle): Promise<void>;
  /** A user message inside the session. The message is already tracked. */
  onMessage?(session: LearningHandle, ctx: BotContext): Promise<void>;
}

export interface SessionManagerDeps {
  api: Api;
  db: Db;
  hub: HubService;
  timeouts: SessionTimeouts;
  log: Logger;
  i18n: Translator;
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

/** Telegram's deleteMessages takes at most 100 IDs per call. */
const DELETE_BATCH = 100;

export class SessionManager {
  private readonly handlers = new Map<SessionKind, SessionKindHandler>();

  constructor(private readonly deps: SessionManagerDeps) {}

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
   * Starts a session of `kind` unless the user already has an active one, in which case nothing
   * changes and the active session is returned so the caller can offer to cancel it.
   */
  async start(user: HubUser, kind: SessionKind): Promise<StartOutcome> {
    const handler = this.handlers.get(kind);
    if (!handler) throw new Error(`no handler registered for session kind "${kind}"`);

    const result = await createSession(this.deps.db, user.id, kind);
    if (!result.created) return { started: false, active: result.active };

    await this.deps.timeouts.schedule(result.session.id);
    const settings = await getSettings(this.deps.db, user.id);
    const handle = this.handle(result.session, user, settings?.uiLang ?? DEFAULT_LOCALE);
    await handler.onStart(handle);
    return { started: true, handle };
  }

  handle(session: LearningSession, user: HubUser, locale: Locale): LearningHandle {
    const send = async (text: string, options?: SendOptions) => {
      const message = await this.deps.api.sendMessage(user.telegramId, text, options);
      await trackMessage(this.deps.db, session.id, message.chat.id, message.message_id);
      return message;
    };
    return {
      session,
      user,
      locale,
      send,
      reply: send,
      track: (messageId) => trackMessage(this.deps.db, session.id, user.telegramId, messageId),
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
   * it. Returns false (and does nothing) when the session was not active any more.
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

    if (
      !(await endSession(
        db,
        sessionId,
        status,
        summary ?? (await this.defaultSummary(user, status)),
      ))
    ) {
      return false;
    }

    await timeouts.cancel(sessionId).catch((error: unknown) => {
      log.warn("session timeout cancel failed", { sessionId, error });
    });
    await this.deleteTracked(sessionId);
    await hub.bump(user);
    return true;
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
