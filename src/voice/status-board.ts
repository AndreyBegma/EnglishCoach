import type { Api } from "grammy";
import { isMessageGoneError, isNotModifiedError } from "../bot/telegram-errors";
import type { Logger } from "../log";

/** While the backfill runs the board is edited at most this often; start and end always show. */
export const STATUS_BOARD_INTERVAL_MS = 60_000;

/** Where the board's message id is kept (`tts_status_board` in production). */
export interface StatusBoardStore {
  messageId(): Promise<number | undefined>;
  setMessageId(messageId: number | undefined): Promise<void>;
}

export interface StatusBoardDeps {
  api: Api;
  chatId: number;
  store: StatusBoardStore;
  log: Logger;
  now?: () => number;
  intervalMs?: number;
}

/**
 * One pinned message in the storage chat that says how the voice backfill is doing. It is edited
 * in place, never posted again per update; when it is gone (deleted by hand, or too old to edit)
 * a new one is sent and pinned, and its id replaces the old one. The "pinned a message" notice is
 * deleted by `pinNoticeCleanup`, which the bot runs for the storage chat too.
 */
export class StatusBoard {
  private lastShownAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: StatusBoardDeps) {}

  get chatId(): number {
    return this.deps.chatId;
  }

  /** Whether an unforced `show` would update the board now. */
  due(): boolean {
    const now = (this.deps.now ?? Date.now)();
    return now - this.lastShownAt >= (this.deps.intervalMs ?? STATUS_BOARD_INTERVAL_MS);
  }

  /**
   * Shows `text` (HTML). Without `force`, does nothing within `intervalMs` of the last time.
   * Never throws: the board is a convenience and must not stop the backfill.
   */
  async show(text: string, options: { force?: boolean } = {}): Promise<void> {
    if (!options.force && !this.due()) return;
    this.lastShownAt = (this.deps.now ?? Date.now)();
    try {
      if (await this.edit(text)) return;
      await this.create(text);
    } catch (error) {
      this.deps.log.warn("voice status board update failed", { error });
    }
  }

  /** True when the stored message now shows `text`; false when there is none to edit. */
  private async edit(text: string): Promise<boolean> {
    const { api, chatId, store } = this.deps;
    const messageId = await store.messageId();
    if (messageId === undefined) return false;
    try {
      await api.editMessageText(chatId, messageId, text, { parse_mode: "HTML" });
      return true;
    } catch (error) {
      if (isNotModifiedError(error)) return true;
      if (!isMessageGoneError(error)) throw error;
      await store.setMessageId(undefined);
      return false;
    }
  }

  private async create(text: string): Promise<void> {
    const { api, chatId, store, log } = this.deps;
    const sent = await api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      disable_notification: true,
    });
    await store.setMessageId(sent.message_id);
    await api
      .pinChatMessage(chatId, sent.message_id, { disable_notification: true })
      .catch((error: unknown) => log.warn("voice status board pin failed", { error }));
  }
}
