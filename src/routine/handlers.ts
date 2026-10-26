import { Composer } from "grammy";
import type { BotContext } from "../bot/context";
import { parseRoutineCallback } from "./callbacks";
import type { Routine } from "./routine";

/** The routine prompt's buttons. Mount before the outdated-button fallback. */
export function routineHandlers(routine: Routine): Composer<BotContext> {
  const composer = new Composer<BotContext>();
  composer.on("callback_query:data", async (ctx, next) => {
    const callback = parseRoutineCallback(ctx.callbackQuery.data);
    if (!callback) return next();
    await routine.onCallback(ctx, callback);
  });
  return composer;
}
