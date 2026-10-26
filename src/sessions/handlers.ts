import { Composer, InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";
import { encodeCallback, parseCallback } from "../bot/callbacks";
import type { BotContext } from "../bot/context";
import type { LearningSession } from "../db/schema";
import type { HubUser } from "../hub/hub-service";
import type { SessionManager } from "./session-manager";

export const isCommand = (message: Message) =>
  message.entities?.some((entity) => entity.type === "bot_command" && entity.offset === 0) ?? false;

/**
 * Runs after access and i18n. For a user with an active session: sets `ctx.learning`, tracks every
 * incoming message, restarts the inactivity countdown, and routes non-command text to the
 * session kind's handler. Commands fall through so /menu and /cancel keep working mid-session.
 */
export function sessionMiddleware(sessions: SessionManager): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  // Everything downstream runs as this update, so a session it starts gets `ctx` in `onStart`.
  composer.use((ctx, next) => sessions.inUpdate(ctx, next));

  composer.use(async (ctx, next) => {
    const active = await sessions.findActive(ctx.user.id);
    if (!active) return next();

    ctx.learning = sessions.handle(active, ctx.user, ctx.settings.uiLang);
    const message = ctx.message;
    if (message && ctx.chat) {
      await sessions.recordIncoming(active, ctx.chat.id, message.message_id);
      const handler = sessions.handlerFor(active.kind);
      if (handler?.onMessage && !isCommand(message)) {
        await handler.onMessage(ctx.learning, ctx);
        return;
      }
    }
    await next();
  });

  composer.command("cancel", async (ctx) => {
    await ctx.learning?.end("cancelled");
  });

  composer.on("callback_query:data", async (ctx, next) => {
    const callback = parseCallback(ctx.callbackQuery.data);
    if (callback?.type === "session-cancel") {
      await ctx.answerCallbackQuery();
      if (ctx.learning?.session.id === callback.sessionId) await ctx.learning.end("cancelled");
      else await ctx.deleteMessage().catch(() => {});
      return;
    }
    if (callback?.type === "session-keep") {
      await ctx.answerCallbackQuery();
      await ctx.deleteMessage().catch(() => {});
      return;
    }
    await next();
  });

  return composer;
}

/**
 * Asks whether to cancel the active session so a new one can start. The question is a session
 * message itself, so it disappears with the session.
 */
export async function offerToCancel(
  sessions: SessionManager,
  ctx: BotContext,
  active: LearningSession,
  user: HubUser,
): Promise<void> {
  const handle = ctx.learning ?? sessions.handle(active, user, ctx.settings.uiLang);
  await handle.send(ctx.t("session-conflict"), {
    reply_markup: new InlineKeyboard()
      .text(
        ctx.t("session-cancel-current"),
        encodeCallback({ type: "session-cancel", sessionId: active.id }),
      )
      .row()
      .text(ctx.t("session-keep-current"), encodeCallback({ type: "session-keep" })),
  });
}
