import type { Api } from "grammy";
import type { HubScreen } from "../bot/callbacks";
import type { Translator } from "../bot/i18n";
import {
  isIgnorableDeleteError,
  isMessageGoneError,
  isNotModifiedError,
} from "../bot/telegram-errors";
import type { Db } from "../db/client";
import { markNotified } from "../db/repositories/achievements";
import { countDueCards, getHub, saveHub } from "../db/repositories/hub";
import { lastSummaryLine } from "../db/repositories/sessions";
import { getSettings } from "../db/repositories/users";
import type { User } from "../db/schema";
import { pendingUnlocks, unlockNotice } from "../gamification/achievements/view";
import type { Logger } from "../log";
import { loadProgress } from "../progress/queries";
import { type RenderedScreen, renderScreen } from "./screens";

/** Hubs live in the private chat with the user, whose chat ID is the user's Telegram ID. */
export type HubUser = Pick<User, "id" | "telegramId">;

export interface HubDeps {
  api: Api;
  db: Db;
  i18n: Translator;
  log: Logger;
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

  private async render(user: HubUser, screen: HubScreen): Promise<RenderedScreen> {
    const [settings, dueCount, lastSummary, unlocks] = await Promise.all([
      getSettings(this.deps.db, user.id),
      countDueCards(this.deps.db, user.id),
      lastSummaryLine(this.deps.db, user.id),
      screen === "main" ? pendingUnlocks(this.deps.db, user.id) : undefined,
    ]);
    const locale = settings?.uiLang ?? "en";
    const progress =
      screen === "progress" ? await loadProgress(this.deps.db, user.id, settings) : undefined;
    const rendered = renderScreen(this.deps.i18n, screen, {
      locale,
      dueCount,
      lastSummary,
      unlockNotice: unlocks && unlockNotice(this.deps.i18n, locale, unlocks.entries),
      progress,
    });
    return unlocks?.ids.length ? { ...rendered, announced: unlocks.ids } : rendered;
  }

  /**
   * New unlocks ride the hub, not messages of their own: once a main screen naming them is on
   * screen they are marked shown, so the next render drops the line. Never fails the hub.
   */
  private async markAnnounced(user: HubUser, rendered: RenderedScreen): Promise<void> {
    if (!rendered.announced?.length) return;
    await markNotified(this.deps.db, user.id, rendered.announced, new Date()).catch(
      (error: unknown) =>
        this.deps.log.warn("achievement notice mark failed", { userId: user.id, error }),
    );
  }

  /** Returns false when there is no hub to edit any more. */
  private async editInPlace(
    user: HubUser,
    render: () => Promise<RenderedScreen>,
  ): Promise<boolean> {
    const hub = await getHub(this.deps.db, user.id);
    if (!hub) return false;
    const rendered = await render();
    try {
      await this.deps.api.editMessageText(hub.chatId, hub.messageId, rendered.text, {
        reply_markup: rendered.keyboard,
      });
    } catch (error) {
      if (isMessageGoneError(error)) return false;
      if (!isNotModifiedError(error)) throw error;
    }
    await this.markAnnounced(user, rendered);
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

    const rendered = await this.render(user, "main");
    const message = await api.sendMessage(chatId, rendered.text, {
      reply_markup: rendered.keyboard,
    });
    await saveHub(db, { userId: user.id, chatId, messageId: message.message_id, pinned: false });
    await this.markAnnounced(user, rendered);

    try {
      await api.pinChatMessage(chatId, message.message_id, { disable_notification: true });
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
