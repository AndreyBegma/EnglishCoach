import type { Api } from "grammy";
import type { HubScreen } from "../bot/callbacks";
import type { Translator } from "../bot/i18n";
import {
  isIgnorableDeleteError,
  isMessageGoneError,
  isNotModifiedError,
} from "../bot/telegram-errors";
import type { Db } from "../db/client";
import { countDueCards, getHub, saveHub } from "../db/repositories/hub";
import { lastSummaryLine } from "../db/repositories/sessions";
import { getSettings } from "../db/repositories/users";
import type { User } from "../db/schema";
import type { Logger } from "../log";
import { loadProgress } from "../progress/queries";
import type { PinNotices } from "./pin-notices";
import { type RenderedScreen, renderScreen } from "./screens";

/** Hubs live in the private chat with the user, whose chat ID is the user's Telegram ID. */
export type HubUser = Pick<User, "id" | "telegramId">;

export interface HubDeps {
  api: Api;
  db: Db;
  i18n: Translator;
  log: Logger;
  /** Deletes the service message each pin adds to the chat. */
  pins: PinNotices;
}

/**
 * Owns the single pinned menu message per chat (docs/ARCHITECTURE.md → Telegram UX rules).
 * Calls for one user are serialised in-process, so concurrent bumps cannot leave two hubs.
 */
export class HubService {
  private readonly queues = new Map<number, Promise<unknown>>();

  constructor(private readonly deps: HubDeps) {}

  /** The current hub message ID for a user, if one was sent. */
  async messageId(user: HubUser): Promise<number | undefined> {
    return (await getHub(this.deps.db, user.id))?.messageId;
  }

  /** Makes sure the user has a hub: edits the existing one back to the main screen, or sends one. */
  show(user: HubUser): Promise<void> {
    return this.refresh(user, "main");
  }

  /** Re-renders the hub in place on the given screen; sends a new hub if the old one is gone. */
  refresh(user: HubUser, screen: HubScreen = "main"): Promise<void> {
    return this.present(user, () => this.render(user, screen));
  }

  /**
   * Edits the hub into a screen another module renders (settings). Like `refresh`, a hub that is
   * gone is replaced by a new one on the main screen.
   */
  present(user: HubUser, render: () => Promise<RenderedScreen>): Promise<void> {
    return this.serialised(user, async () => {
      if (!(await this.editInPlace(user, render))) await this.sendNew(user);
    });
  }

  /** Deletes the current hub and sends and pins a fresh one at the bottom of the chat. */
  bump(user: HubUser): Promise<void> {
    return this.serialised(user, () => this.sendNew(user));
  }

  private async render(user: HubUser, screen: HubScreen) {
    const [settings, dueCount, lastSummary] = await Promise.all([
      getSettings(this.deps.db, user.id),
      countDueCards(this.deps.db, user.id),
      lastSummaryLine(this.deps.db, user.id),
    ]);
    const progress =
      screen === "progress" ? await loadProgress(this.deps.db, user.id, settings) : undefined;
    return renderScreen(this.deps.i18n, screen, {
      locale: settings?.uiLang ?? "en",
      dueCount,
      lastSummary,
      progress,
    });
  }

  /** Returns false when there is no hub to edit any more. */
  private async editInPlace(
    user: HubUser,
    render: () => Promise<RenderedScreen>,
  ): Promise<boolean> {
    const hub = await getHub(this.deps.db, user.id);
    if (!hub) return false;
    const { text, keyboard } = await render();
    try {
      await this.deps.api.editMessageText(hub.chatId, hub.messageId, text, {
        reply_markup: keyboard,
      });
    } catch (error) {
      if (isNotModifiedError(error)) return true;
      if (isMessageGoneError(error)) return false;
      throw error;
    }
    return true;
  }

  private async sendNew(user: HubUser): Promise<void> {
    const { api, db, log } = this.deps;
    const chatId = user.telegramId;
    const old = await getHub(db, user.id);
    if (old) {
      await api.deleteMessage(old.chatId, old.messageId).catch((error: unknown) => {
        if (!isIgnorableDeleteError(error)) throw error;
      });
    }

    const { text, keyboard } = await this.render(user, "main");
    const message = await api.sendMessage(chatId, text, { reply_markup: keyboard });
    await saveHub(db, { userId: user.id, chatId, messageId: message.message_id, pinned: false });

    try {
      await api.pinChatMessage(chatId, message.message_id, { disable_notification: true });
      this.deps.pins.pinned(chatId, message.message_id);
      await saveHub(db, { userId: user.id, chatId, messageId: message.message_id, pinned: true });
    } catch (error) {
      // An unpinned hub still works; do not fail the whole update over it.
      log.warn("hub pin failed", { userId: user.id, error });
    }
  }

  private serialised<T>(user: HubUser, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(user.id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.queues.set(user.id, next);
    const cleanup = () => {
      if (this.queues.get(user.id) === next) this.queues.delete(user.id);
    };
    next.then(cleanup, cleanup);
    return next;
  }
}
