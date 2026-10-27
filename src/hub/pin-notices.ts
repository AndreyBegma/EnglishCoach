import type { Context, MiddlewareFn } from "grammy";
import { isIgnorableDeleteError } from "../bot/telegram-errors";
import type { Logger } from "../log";

/**
 * Deletes the "… pinned a message" notice Telegram adds to a private chat when the bot pins the
 * hub (docs/ARCHITECTURE.md → Telegram UX rules). `pinChatMessage` returns only `true`, so the
 * notice is known only from its own update: a private-chat message carrying `pinned_message`
 * whose sender is this bot. Exactly that message is deleted, and nothing else.
 *
 * When Telegram does not deliver that update, the notice stays. The Bot API has no call that
 * reads a message by ID, so a guessed ID (the one after the hub) could never be verified as
 * the notice rather than a learner's message, and the bot does not delete what it cannot verify.
 *
 * Runs before access control, which drops every update from a bot.
 */
export function pinNoticeCleanup(log: Logger): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const message = ctx.message;
    if (
      message?.chat.type !== "private" ||
      !message.pinned_message ||
      message.from?.id !== ctx.me.id
    ) {
      return next();
    }
    await ctx.api.deleteMessage(message.chat.id, message.message_id).catch((error: unknown) => {
      if (!isIgnorableDeleteError(error)) log.warn("pin notice delete failed", { error });
    });
  };
}
