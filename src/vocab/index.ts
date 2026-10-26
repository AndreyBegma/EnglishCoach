import { Composer } from "grammy";
import type { BotContext } from "../bot/context";
import { isVocabCallbackData, parseVocabCallback } from "./callbacks";
import { VocabCore, type VocabDeps } from "./core";
import { LearnFlow } from "./learn";
import { ReviewFlow } from "./review";

export type { VocabDeps } from "./core";

/**
 * The vocabulary sessions: `learn` for kind `vocab_new`, `review` for kind `review`, and the
 * composer that routes their buttons (mount it before the outdated-button fallback).
 */
export function vocabSessions(deps: VocabDeps) {
  const core = new VocabCore(deps);
  const learn = new LearnFlow(core);
  const review = new ReviewFlow(core);

  const composer = new Composer<BotContext>();
  composer.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!isVocabCallbackData(data)) return next();

    const callback = parseVocabCallback(data);
    const handle = ctx.learning;
    const flow =
      handle?.session.kind === "vocab_new"
        ? learn
        : handle?.session.kind === "review"
          ? review
          : undefined;
    // A button of a finished session, an earlier question, or an older bot version.
    if (!callback || !handle || !flow?.accepts(handle, ctx, callback)) {
      await ctx.answerCallbackQuery({ text: ctx.t("vocab-outdated") });
      return;
    }
    await ctx.answerCallbackQuery();
    await flow.onCallback(handle, ctx, callback);
  });

  return { learn, review, composer };
}
