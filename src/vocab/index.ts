import { Composer } from "grammy";
import type { BotContext } from "../bot/context";
import { acceptAnswer } from "../sessions/answer";
import { isVocabCallbackData, parseVocabCallback, type VocabCallback } from "./callbacks";
import { VocabCore, type VocabDeps } from "./core";
import { LearnFlow } from "./learn";
import { ReviewFlow } from "./review";

export type { VocabDeps } from "./core";

/**
 * Buttons that answer nothing and prepare no next item: they act at once. Every other vocabulary
 * button goes through `acceptAnswer` (one at a time, marked and stripped of its keyboard).
 */
const UNLOCKED_OPS: ReadonlySet<VocabCallback["op"]> = new Set([
  "add-word",
  "add-cancel",
  "finish",
]);

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
    // A button of a finished session or an older bot version.
    if (!callback || !handle || !flow) {
      await ctx.answerCallbackQuery({ text: ctx.t("vocab-outdated") });
      return;
    }
    if (UNLOCKED_OPS.has(callback.op)) {
      if (!flow.accepts(handle, ctx, callback)) {
        await ctx.answerCallbackQuery({ text: ctx.t("vocab-outdated") });
        return;
      }
      await ctx.answerCallbackQuery();
      await flow.onCallback(handle, ctx, callback);
      return;
    }
    // A button of a card or exercise that is no longer the one on screen is "already answered";
    // that is asked holding the lock, so two taps cannot both pass it.
    await acceptAnswer(
      ctx,
      { lock: handle.withLock, current: () => flow.accepts(handle, ctx, callback) },
      () => flow.onCallback(handle, ctx, callback),
    );
  });

  return { learn, review, composer };
}
