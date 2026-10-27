import type { Api, Context, MiddlewareFn, Transformer } from "grammy";
import { isIgnorableDeleteError } from "../bot/telegram-errors";
import type { Logger } from "../log";

export interface PinNoticesDeps {
  api: Api;
  log: Logger;
  /** How long a proven candidate waits for a late reply that might claim its ID. */
  settleMs?: number;
}

/** A pin whose service message has not been deleted yet. */
interface PendingPin {
  hubId: number;
  /** The lowest ID above the hub that no known message holds: where the notice must be. */
  candidate: number;
}

interface ChatState {
  /** IDs of messages the bot sent or received in this chat, recent ones only. */
  seen: Set<number>;
  pending: PendingPin[];
  /** Hubs whose notice arrived as an update and is gone already. */
  cleared: Set<number>;
}

const SEEN_LIMIT = 200;
const PENDING_LIMIT = 5;

/**
 * Deletes the "… pinned a message" notice Telegram adds to a private chat when the hub is
 * pinned (docs/ARCHITECTURE.md → Telegram UX rules). `pinChatMessage` returns only `true`, so
 * the notice's ID comes from one of two places:
 *
 * - the notice itself, when Telegram delivers it as a `pinned_message` update from the bot;
 * - otherwise the next message ID after the hub, verified: every ID the bot sends (through the
 *   API transformer) or receives (through the middleware) is recorded, and the lowest unknown
 *   ID above the hub is deleted only once a later incoming message proves that every earlier
 *   message of the learner has been delivered. A learner's or a session's message is never the
 *   one deleted.
 *
 * State is in memory: a notice still unproven at a restart stays in the chat.
 */
export class PinNotices {
  private readonly chats = new Map<number, ChatState>();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly deps: PinNoticesDeps) {}

  /** Records the IDs of every message the bot sends. Install on `bot.api.config`. */
  readonly transformer: Transformer = async (prev, method, payload, signal) => {
    const response = await prev(method, payload, signal);
    if (response.ok && /^(send|copy|forward)/.test(method)) {
      const chatId = Number((payload as { chat_id?: unknown } | undefined)?.chat_id);
      if (Number.isSafeInteger(chatId)) {
        for (const id of messageIdsOf(response.result)) this.observe(chatId, id);
      }
    }
    return response;
  };

  /**
   * Runs before access control, which drops updates from bots: deletes the bot's own pin notice
   * and uses every incoming message ID as proof for the fallback.
   */
  middleware(): MiddlewareFn<Context> {
    return async (ctx, next) => {
      const message = ctx.message;
      if (message?.chat.type !== "private") return next();
      const chatId = message.chat.id;

      if (message.pinned_message && message.from?.id === ctx.me.id) {
        const hubId = message.pinned_message.message_id;
        this.observe(chatId, message.message_id);
        // Delivered before `pinChatMessage` returned: tell `pinned` not to chase it.
        if (!this.dropPending(chatId, hubId)) this.state(chatId).cleared.add(hubId);
        await this.delete(chatId, message.message_id);
        return;
      }

      this.observe(chatId, message.message_id);
      this.prove(chatId, message.message_id);
      return next();
    };
  }

  /** Call after `pinChatMessage(chatId, hubId)` succeeded. */
  pinned(chatId: number, hubId: number): void {
    const state = this.state(chatId);
    if (state.cleared.delete(hubId)) return;
    state.pending.push({ hubId, candidate: this.nextUnseen(state, hubId) });
    if (state.pending.length > PENDING_LIMIT) state.pending.shift();
  }

  /** Resolves when no deletion is scheduled or running. Tests await it. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all(this.inFlight);
  }

  private state(chatId: number): ChatState {
    let state = this.chats.get(chatId);
    if (!state) {
      state = { seen: new Set(), pending: [], cleared: new Set() };
      this.chats.set(chatId, state);
    }
    return state;
  }

  private observe(chatId: number, id: number): void {
    const state = this.state(chatId);
    state.seen.add(id);
    if (state.seen.size > SEEN_LIMIT) {
      const oldest = Math.min(...state.seen);
      state.seen.delete(oldest);
    }
    for (const pin of state.pending) {
      if (pin.candidate === id) pin.candidate = this.nextUnseen(state, id);
    }
  }

  private nextUnseen(state: ChatState, after: number): number {
    let id = after + 1;
    while (state.seen.has(id)) id++;
    return id;
  }

  /** An incoming message with a higher ID: every pin below it holds a candidate nobody claimed. */
  private prove(chatId: number, incomingId: number): void {
    const state = this.state(chatId);
    for (const pin of state.pending.filter((pending) => pending.candidate < incomingId)) {
      this.dropPending(chatId, pin.hubId);
      this.track(this.settleThenDelete(chatId, pin));
    }
  }

  private async settleThenDelete(chatId: number, pin: PendingPin): Promise<void> {
    const settleMs = this.deps.settleMs ?? 1000;
    if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
    const state = this.state(chatId);
    // A reply that was still in flight may have claimed the ID; then the notice is out of reach.
    if (state.seen.has(pin.candidate)) return;
    state.seen.add(pin.candidate);
    await this.delete(chatId, pin.candidate);
  }

  /** Returns whether a pending pin was dropped. */
  private dropPending(chatId: number, hubId: number): boolean {
    const state = this.state(chatId);
    const before = state.pending.length;
    state.pending = state.pending.filter((pin) => pin.hubId !== hubId);
    return state.pending.length < before;
  }

  private async delete(chatId: number, messageId: number): Promise<void> {
    await this.deps.api.deleteMessage(chatId, messageId).catch((error: unknown) => {
      if (!isIgnorableDeleteError(error)) this.deps.log.warn("pin notice delete failed", { error });
    });
  }

  private track(task: Promise<void>): void {
    this.inFlight.add(task);
    task.finally(() => this.inFlight.delete(task));
  }
}

/** Message IDs in a send/copy/forward result: one message, or an array of them. */
function messageIdsOf(result: unknown): number[] {
  const items = Array.isArray(result) ? result : [result];
  return items.flatMap((item) => {
    const id = (item as { message_id?: unknown } | null)?.message_id;
    return typeof id === "number" ? [id] : [];
  });
}
