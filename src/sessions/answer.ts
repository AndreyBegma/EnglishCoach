import type { BotContext } from "../bot/context";

/** Telegram shows a chat action for about 5 s; it is repeated while the work goes on. */
const TYPING_EVERY_MS = 4_000;

/** Runs `task` holding a lock; false, without running it, when the lock is held. */
export type Lock = (task: () => Promise<void>) => Promise<boolean>;

export interface AcceptOptions {
  /** The session's `withLock`, or the manager's for a button outside a session. */
  lock: Lock;
  /** The chosen option as the learner sees it; defaults to the tapped button's label. */
  chosen?: string;
  /**
   * Whether the tap belongs to the item on screen. Asked holding the lock, so no other answer can
   * move the session on between the check and the work; false answers "already answered".
   */
  current?: () => boolean;
}

/** The label of the button the callback came from, if the message still shows it. */
export function tappedLabel(ctx: BotContext): string | undefined {
  const query = ctx.callbackQuery;
  const message = query?.message;
  const rows = message && "reply_markup" in message ? message.reply_markup?.inline_keyboard : [];
  for (const button of rows?.flat() ?? []) {
    if ("callback_data" in button && button.callback_data === query?.data) return button.text;
  }
  return undefined;
}

/**
 * The one way an answer-like button is taken. While another answer of the same session is in
 * flight, the tap is dropped with a "wait" toast, never queued. A tap for an item that is no
 * longer on screen (`current`) is dropped with "already answered". Otherwise, before `task`
 * runs: the toast says the answer was accepted, the tapped message marks the choice and loses its
 * keyboard, and the chat shows "typing" until `task` ends. Returns false for a dropped tap.
 */
export async function acceptAnswer(
  ctx: BotContext,
  { lock, chosen = tappedLabel(ctx) ?? "", current = () => true }: AcceptOptions,
  task: () => Promise<void>,
): Promise<boolean> {
  let stale = false;
  const ran = await lock(async () => {
    if (!current()) {
      stale = true;
      return;
    }
    await ctx.answerCallbackQuery({ text: ctx.t("answer-accepted", { answer: chosen }) });
    await markAccepted(ctx, chosen);
    await whileTyping(ctx, task);
  });
  if (stale) await rejectStaleAnswer(ctx);
  else if (!ran) await ctx.answerCallbackQuery({ text: ctx.t("answer-busy") });
  return ran && !stale;
}

/** A tap on a button of an item that is no longer the one on screen. */
async function rejectStaleAnswer(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery({ text: ctx.t("answer-stale") });
}

/**
 * Edits the tapped message: its text (formatting kept through the entities), the choice and a
 * "preparing" line, and no keyboard, so nothing on it can be tapped again. Best effort: a message
 * that is gone or cannot be edited changes nothing about the answer.
 */
async function markAccepted(ctx: BotContext, chosen: string): Promise<void> {
  const message = ctx.callbackQuery?.message;
  if (!message || !("chat" in message)) return;
  const lines = `\n\n${ctx.t("answer-chosen", { answer: chosen })}\n${ctx.t("answer-preparing")}`;
  const edit =
    "text" in message && message.text !== undefined
      ? ctx.api.editMessageText(message.chat.id, message.message_id, message.text + lines, {
          entities: message.entities,
        })
      : "caption" in message && message.caption !== undefined
        ? ctx.api.editMessageCaption(message.chat.id, message.message_id, {
            caption: message.caption + lines,
            caption_entities: message.caption_entities,
          })
        : ctx.api.editMessageReplyMarkup(message.chat.id, message.message_id);
  await edit.catch(() => {});
}

/** Runs `task` with the "typing" chat action on, repeated until it ends. */
export async function whileTyping<T>(ctx: BotContext, task: () => Promise<T>): Promise<T> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return task();
  const type = () => void ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  type();
  const timer = setInterval(type, TYPING_EVERY_MS);
  timer.unref?.();
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}
