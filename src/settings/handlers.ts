import { Composer } from "grammy";
import { isSettingsCallback, parseCallback } from "../bot/callbacks";
import type { BotContext } from "../bot/context";
import { isIgnorableDeleteError } from "../bot/telegram-errors";
import { answerOutdated } from "../hub/handlers";
import type { HubService } from "../hub/hub-service";
import type { Logger } from "../log";
import { isCommand } from "../sessions/handlers";
import type { SettingsController } from "./controller";
import { SETTINGS_INPUT_TTL_MS } from "./state";

export interface SettingsHandlerDeps {
  hub: HubService;
  controller: SettingsController;
  log: Logger;
}

/**
 * Consumes the message answering a pending settings input. It runs before the learning-session
 * middleware, so a key typed during a session never reaches the session's handler. Commands and
 * stale inputs drop the pending input and fall through.
 */
export function settingsInputMiddleware({
  controller,
  log,
}: SettingsHandlerDeps): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.on("message", async (ctx, next) => {
    const pending = ctx.session.settingsInput;
    if (!pending) return next();
    if (Date.now() - pending.since > SETTINGS_INPUT_TTL_MS || isCommand(ctx.message)) {
      ctx.session.settingsInput = undefined;
      return next();
    }

    // First, before any check or network call: the message may carry an API key.
    await ctx.deleteMessage().catch((error: unknown) => {
      if (!isIgnorableDeleteError(error)) {
        log.warn("settings input delete failed", { userId: ctx.user.id, error });
      }
    });
    await controller.onInput(ctx, pending);
  });

  return composer;
}

/** Settings buttons. Like every hub button they only count on the current hub message. */
export function settingsHandlers({ hub, controller }: SettingsHandlerDeps): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.on("callback_query:data", async (ctx, next) => {
    const callback = parseCallback(ctx.callbackQuery.data);
    if (!isSettingsCallback(callback)) return next();
    const hubMessageId = await hub.messageId(ctx.user);
    if (ctx.callbackQuery.message?.message_id !== hubMessageId) return answerOutdated(ctx, hub);
    await controller.onCallback(ctx, callback);
  });

  return composer;
}
