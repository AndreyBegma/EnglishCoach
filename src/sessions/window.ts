import type { Api, InputFile } from "grammy";
import type { InlineKeyboardMarkup, Message, ParseMode } from "grammy/types";
import type { BotContext } from "../bot/context";
import {
  isIgnorableDeleteError,
  isMessageGoneError,
  isNotModifiedError,
} from "../bot/telegram-errors";
import type { Logger } from "../log";

/** How long a flash note stays on screen. */
export const NOTE_TTL_MS = 5_000;

interface ScreenMarkup {
  parse_mode?: ParseMode;
  /** Every screen replaces the keyboard; a screen without one leaves no buttons behind. */
  reply_markup?: InlineKeyboardMarkup;
}

/** One step of a session as the learner sees it: a text message or a photo with a caption. */
export type Screen =
  | ({ text: string } & ScreenMarkup)
  | ({ photo: InputFile | string; caption?: string } & ScreenMarkup);

type Media = "text" | "photo";

/** The window of one session. Kept in memory and mirrored into grammY's session for restarts. */
export interface WindowState {
  sessionId: number;
  messageId: number;
  media: Media;
  /** Messages tied to the step on screen (a voice note); deleted when the next step shows. */
  attachments: number[];
}

declare module "../bot/context" {
  interface FlowState {
    window?: WindowState;
  }
}

/** A stored window state, or undefined when it is missing or corrupt. */
function windowState(value: unknown): WindowState | undefined {
  const state = value as Partial<WindowState> | undefined;
  return typeof state?.sessionId === "number" && typeof state.messageId === "number"
    ? {
        sessionId: state.sessionId,
        messageId: state.messageId,
        media: state.media === "photo" ? "photo" : "text",
        attachments: Array.isArray(state.attachments) ? state.attachments : [],
      }
    : undefined;
}

export interface SessionWindowsDeps {
  api: Api;
  log: Logger;
  noteTtlMs?: number;
}

interface LiveNote {
  messageId: number;
  chatId: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The one window per session: every step is an edit of the same message, so the chat holds the hub
 * and this window. Hints live a few seconds as flash notes; the learner's messages are deleted once
 * read. Everything sent here is tracked, so session cleanup removes whatever is left.
 */
export class SessionWindows {
  private readonly windows = new Map<number, WindowState>();
  private readonly notes = new Map<number, LiveNote>();

  constructor(private readonly deps: SessionWindowsDeps) {}

  /** The window of `sessionId` in chat `chatId`; `track` records a message for cleanup. */
  open(
    sessionId: number,
    chatId: number,
    track: (messageId: number) => Promise<void>,
    ctx?: BotContext,
  ): SessionWindow {
    return new SessionWindow(this, this.deps, sessionId, chatId, track, ctx);
  }

  /** Forgets a session that ended; its messages are deleted by the session cleanup. */
  forget(sessionId: number): void {
    this.windows.delete(sessionId);
    const note = this.notes.get(sessionId);
    if (note) clearTimeout(note.timer);
    this.notes.delete(sessionId);
  }

  /** Deletes every live flash note now instead of when its timer fires (tests, shutdown). */
  async flushNotes(): Promise<void> {
    const live = [...this.notes.entries()];
    await Promise.all(
      live.map(([sessionId, note]) => {
        clearTimeout(note.timer);
        return this.dropNote(sessionId, note.messageId);
      }),
    );
  }

  /** @internal */
  stateOf(sessionId: number, ctx?: BotContext): WindowState | undefined {
    const inMemory = this.windows.get(sessionId);
    if (inMemory) return inMemory;
    const stored = windowState(ctx?.session.window);
    return stored?.sessionId === sessionId ? stored : undefined;
  }

  /** @internal */
  save(state: WindowState, ctx?: BotContext): void {
    this.windows.set(state.sessionId, state);
    if (ctx) ctx.session.window = { ...state, attachments: [...state.attachments] };
  }

  /** @internal Replaces the live note of a session, if any, with `note`. */
  async setNote(sessionId: number, note: Omit<LiveNote, "timer">): Promise<void> {
    const previous = this.notes.get(sessionId);
    if (previous) {
      clearTimeout(previous.timer);
      this.notes.delete(sessionId);
      await this.deleteQuietly(previous.chatId, previous.messageId);
    }
    const timer = setTimeout(() => {
      void this.dropNote(sessionId, note.messageId);
    }, this.deps.noteTtlMs ?? NOTE_TTL_MS);
    timer.unref?.();
    this.notes.set(sessionId, { ...note, timer });
  }

  private async dropNote(sessionId: number, messageId: number): Promise<void> {
    const note = this.notes.get(sessionId);
    if (note?.messageId !== messageId) return;
    this.notes.delete(sessionId);
    await this.deleteQuietly(note.chatId, messageId);
  }

  /** @internal A message the bot may delete; one that is already gone is not an error. */
  async deleteQuietly(chatId: number, messageId: number): Promise<void> {
    await this.deps.api.deleteMessage(chatId, messageId).catch((error: unknown) => {
      if (!isIgnorableDeleteError(error)) {
        this.deps.log.debug("session message delete failed", { chatId, messageId, error });
      }
    });
  }
}

/** The window of one session, as handlers use it: `ctx.learning.window`. */
export class SessionWindow {
  constructor(
    private readonly windows: SessionWindows,
    private readonly deps: SessionWindowsDeps,
    private readonly sessionId: number,
    private readonly chatId: number,
    private readonly track: (messageId: number) => Promise<void>,
    private readonly ctx?: BotContext,
  ) {}

  /** The message the window is now, if it has been shown. */
  get messageId(): number | undefined {
    return this.windows.stateOf(this.sessionId, this.ctx)?.messageId;
  }

  /**
   * Shows the next step. Same media: the window is edited in place, keyboard included. Another
   * media (Telegram cannot turn text into a photo), `fresh`, or a window that is gone: a new one
   * is sent and the old one deleted. The previous step's attachments are deleted first.
   */
  async show(screen: Screen, { fresh = false }: { fresh?: boolean } = {}): Promise<number> {
    const state = this.windows.stateOf(this.sessionId, this.ctx);
    for (const id of state?.attachments ?? []) await this.windows.deleteQuietly(this.chatId, id);

    const media: Media = "photo" in screen ? "photo" : "text";
    if (state && !fresh && state.media === media && (await this.edit(state.messageId, screen))) {
      this.windows.save({ ...state, attachments: [] }, this.ctx);
      return state.messageId;
    }

    const message = await this.send(screen);
    await this.track(message.message_id);
    this.windows.save(
      { sessionId: this.sessionId, messageId: message.message_id, media, attachments: [] },
      this.ctx,
    );
    if (state) await this.windows.deleteQuietly(this.chatId, state.messageId);
    return message.message_id;
  }

  /**
   * A hint or warning that deletes itself after a few seconds. A session has at most one: a new
   * note replaces the one on screen. Where there is a callback, answer it with a toast instead.
   */
  async flashNote(text: string, options: { parse_mode?: ParseMode } = {}): Promise<void> {
    const message = await this.deps.api.sendMessage(this.chatId, text, options);
    await this.track(message.message_id);
    await this.windows.setNote(this.sessionId, {
      chatId: this.chatId,
      messageId: message.message_id,
    });
  }

  /** Deletes a message the learner sent, once the bot has read it. */
  consumeUserMessage(messageId: number): Promise<void> {
    return this.discard([messageId]);
  }

  /** Deletes session messages that have served their turn (a chat's older exchanges). */
  async discard(messageIds: readonly number[]): Promise<void> {
    for (const id of messageIds) await this.windows.deleteQuietly(this.chatId, id);
  }

  /** Tracks a message tied to the step on screen (a voice note): the next step deletes it. */
  async attach(messageId: number): Promise<void> {
    await this.track(messageId);
    const state = this.windows.stateOf(this.sessionId, this.ctx);
    if (!state) return;
    this.windows.save({ ...state, attachments: [...state.attachments, messageId] }, this.ctx);
  }

  /** True when the window now shows `screen`; false when there is no window to edit any more. */
  private async edit(messageId: number, screen: Screen): Promise<boolean> {
    const { api } = this.deps;
    const markup = { reply_markup: screen.reply_markup };
    try {
      if ("photo" in screen) {
        await api.editMessageMedia(
          this.chatId,
          messageId,
          {
            type: "photo",
            media: screen.photo,
            caption: screen.caption,
            parse_mode: screen.parse_mode,
          },
          markup,
        );
      } else {
        await api.editMessageText(this.chatId, messageId, screen.text, {
          ...markup,
          parse_mode: screen.parse_mode,
        });
      }
      return true;
    } catch (error) {
      if (isNotModifiedError(error)) return true;
      if (isMessageGoneError(error)) return false;
      throw error;
    }
  }

  private send(screen: Screen): Promise<Message> {
    const { api } = this.deps;
    const options = { parse_mode: screen.parse_mode, reply_markup: screen.reply_markup };
    if ("photo" in screen) {
      return api.sendPhoto(this.chatId, screen.photo, { ...options, caption: screen.caption });
    }
    return api.sendMessage(this.chatId, screen.text, options);
  }
}
