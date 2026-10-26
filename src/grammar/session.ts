import { Composer } from "grammy";
import type { BotContext } from "../bot/context";
import type { Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { upsertMistake } from "../db/repositories/mistakes";
import { getSettings } from "../db/repositories/users";
import type { Logger } from "../log";
import type { LearningHandle, SessionKindHandler } from "../sessions/session-manager";
import type { SkillRunner } from "../skills";
import { parseGrammarCallback } from "./callbacks";
import { type Graded, gradeChoice, gradeTyped } from "./grading";
import { GRAMMAR_CARD_THRESHOLD, promoteMistakeToCard } from "./promotion";
import {
  feedbackText,
  QUESTIONS_PER_SESSION,
  questionKeyboard,
  questionText,
  retryKeyboard,
  topicPicker,
} from "./screens";
import type { GrammarState } from "./state";
import { recordGrammarAnswer } from "./stats";
import { GRAMMAR_TOPICS } from "./topics";

export interface GrammarDeps {
  db: Db;
  skills: SkillRunner;
  i18n: Translator;
  log: Logger;
  /** Session length; tests shorten it. */
  questions?: number;
}

const totalOf = (deps: GrammarDeps) => deps.questions ?? QUESTIONS_PER_SESSION;

/** Item types rotate so a session mixes recall and recognition; the first is always a choice. */
const ITEM_ROTATION = [
  "multiple_choice",
  "gap_fill",
  "error_correction",
  "transformation",
] as const;

/** Running accuracy of this session; null until the first answer. */
const accuracyOf = (state: GrammarState) =>
  state.answered === 0 ? null : state.correct / state.answered;

/** The topic with the most wrong answers, if there was any wrong answer at all. */
function weakestTopic(state: GrammarState): string | null {
  const [worst] = Object.entries(state.wrongByTopic).sort(([, a], [, b]) => b - a);
  return worst ? worst[0] : null;
}

/** The "grammar" session kind: the topic picker on start, typed answers as messages. */
export function grammarSession(deps: GrammarDeps): SessionKindHandler {
  return {
    async onStart(handle, ctx) {
      const seed = ctx?.session.grammarSeed;
      if (ctx) ctx.session.grammarSeed = undefined;
      if (ctx && seed?.length) {
        const fresh: GrammarState = {
          sessionId: handle.session.id,
          topic: null,
          seed,
          asked: 0,
          answered: 0,
          correct: 0,
          recentTopics: [],
          wrongByTopic: {},
        };
        ctx.session.grammar = fresh;
        await handle.send(
          deps.i18n.t(handle.locale, "grammar-practice-intro", { count: seed.length }),
        );
        await askNext(deps, handle, fresh);
        return;
      }
      const settings = await getSettings(deps.db, handle.user.id);
      const picker = topicPicker(deps.i18n, handle.locale, settings?.cefrLevel ?? null);
      await handle.send(picker.text, { reply_markup: picker.keyboard });
    },

    async onMessage(handle, ctx) {
      const text = ctx.message?.text?.trim();
      const state = ownState(ctx, handle);
      if (!text || !state?.current) return;

      const { item } = state.current;
      if (item.type === "multiple_choice") {
        await handle.send(deps.i18n.t(handle.locale, "grammar-use-buttons"));
        return;
      }

      let graded: Graded;
      try {
        graded = await gradeTyped(deps.skills, handle.user.id, item, text);
      } catch (error) {
        deps.log.warn("grammar answer check failed", { sessionId: handle.session.id, error });
        const previous = state.errorId;
        if (previous !== undefined && ctx.chat) {
          await ctx.api.deleteMessage(ctx.chat.id, previous).catch(() => {});
        }
        const note = await handle.send(deps.i18n.t(handle.locale, "grammar-error-check"));
        state.errorId = note.message_id;
        return;
      }
      if (state.errorId !== undefined && ctx.chat) {
        await ctx.api.deleteMessage(ctx.chat.id, state.errorId).catch(() => {});
        state.errorId = undefined;
      }
      await settle(deps, handle, state, graded);
    },
  };
}

/** The state of the session this update belongs to, or undefined when it is stale or not begun. */
function ownState(ctx: BotContext, handle: LearningHandle): GrammarState | undefined {
  const state = ctx.session.grammar;
  return state?.sessionId === handle.session.id ? state : undefined;
}

/** Records a graded answer, shows the feedback and moves on (or ends the session). */
async function settle(
  deps: GrammarDeps,
  handle: LearningHandle,
  state: GrammarState,
  graded: Graded,
): Promise<void> {
  const current = state.current;
  if (!current) return;
  // Cleared before the first await so a second press or message cannot grade the same question.
  state.current = undefined;

  const settings = await getSettings(deps.db, handle.user.id);
  await recordGrammarAnswer(deps.db, handle.user.id, settings?.timezone ?? "UTC", graded.correct);

  state.answered += 1;
  let cardAdded = false;
  if (graded.correct) {
    state.correct += 1;
  } else {
    state.wrongByTopic[current.item.topic] = (state.wrongByTopic[current.item.topic] ?? 0) + 1;
    if (graded.mistake) {
      const row = await upsertMistake(deps.db, handle.user.id, {
        ...graded.mistake,
        explanation: graded.explanation,
      });
      cardAdded =
        row.count >= GRAMMAR_CARD_THRESHOLD && (await promoteMistakeToCard(deps.db, row)) !== null;
    }
  }

  await handle.send(feedbackText(deps.i18n, handle.locale, graded, cardAdded));
  if (state.answered >= totalOf(deps)) await finish(deps, handle, state);
  else await askNext(deps, handle, state);
}

/** Sends the next question, or an error with a retry button when the quiz skill fails. */
async function askNext(deps: GrammarDeps, handle: LearningHandle, state: GrammarState) {
  const n = state.asked + 1;
  let item: NonNullable<GrammarState["current"]>["item"];
  try {
    const run = await deps.skills.runSkill(handle.user.id, "grammar-quiz", {
      recent_accuracy: accuracyOf(state),
      topic: state.seed?.length ? (state.seed[(n - 1) % state.seed.length] ?? null) : state.topic,
      item_type: ITEM_ROTATION[(n - 1) % ITEM_ROTATION.length] ?? null,
      recent_topics: state.recentTopics,
    });
    item = run.data;
  } catch (error) {
    deps.log.warn("grammar question failed", { sessionId: handle.session.id, error });
    await handle.send(deps.i18n.t(handle.locale, "grammar-error-quiz"), {
      reply_markup: retryKeyboard(deps.i18n, handle.locale),
    });
    return;
  }

  const message = await handle.send(
    questionText(deps.i18n, handle.locale, n, totalOf(deps), item),
    {
      reply_markup: questionKeyboard(n, item),
    },
  );
  state.asked = n;
  state.recentTopics.push(item.topic);
  state.current = { n, item, messageId: message.message_id };
}

async function finish(deps: GrammarDeps, handle: LearningHandle, state: GrammarState) {
  const weak = weakestTopic(state);
  const vars = { correct: state.correct, total: state.answered };
  const line = weak
    ? deps.i18n.t(handle.locale, "grammar-summary-weak", { ...vars, weak })
    : deps.i18n.t(handle.locale, "grammar-summary", vars);
  await handle.end("finished", { line, ...vars, weak });
}

/** Buttons of a grammar session: topic choice, multiple-choice answers, retry and stop. */
export function grammarHandlers(deps: GrammarDeps): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.on("callback_query:data", async (ctx, next) => {
    const callback = parseGrammarCallback(ctx.callbackQuery.data);
    if (!callback) return next();

    const handle = ctx.learning;
    if (handle?.session.kind !== "grammar") {
      await ctx.answerCallbackQuery({ text: ctx.t("grammar-outdated") });
      await ctx.deleteMessage().catch(() => {});
      return;
    }
    const state = ownState(ctx, handle);

    switch (callback.type) {
      case "topic": {
        const topic = callback.index === null ? undefined : GRAMMAR_TOPICS[callback.index];
        if (state || (callback.index !== null && !topic)) {
          return void (await ctx.answerCallbackQuery({ text: ctx.t("grammar-outdated") }));
        }
        await ctx.answerCallbackQuery();
        const fresh: GrammarState = {
          sessionId: handle.session.id,
          topic: topic?.tag ?? null,
          asked: 0,
          answered: 0,
          correct: 0,
          recentTopics: [],
          wrongByTopic: {},
        };
        ctx.session.grammar = fresh;
        const chosen = topic
          ? ctx.t(`grammar-topic-${topic.id.replaceAll("_", "-")}`)
          : ctx.t("grammar-mixed");
        await ctx.editMessageText(ctx.t("grammar-topic-chosen", { topic: chosen })).catch(() => {});
        await askNext(deps, handle, fresh);
        return;
      }

      case "answer": {
        const current = state?.current;
        if (!state || !current || current.n !== callback.question) {
          return void (await ctx.answerCallbackQuery({ text: ctx.t("grammar-outdated") }));
        }
        await ctx.answerCallbackQuery();
        const chosen = current.item.options?.[callback.option] ?? "";
        const graded = gradeChoice(current.item, callback.option);
        // Drop the buttons and show what was picked, so the question reads as answered.
        await ctx
          .editMessageText(
            `${questionText(deps.i18n, handle.locale, current.n, totalOf(deps), current.item)}\n\n${ctx.t("grammar-chosen", { answer: chosen })}`,
          )
          .catch(() => {});
        await settle(deps, handle, state, graded);
        return;
      }

      case "retry": {
        if (!state || state.current) {
          return void (await ctx.answerCallbackQuery({ text: ctx.t("grammar-outdated") }));
        }
        await ctx.answerCallbackQuery();
        await ctx.deleteMessage().catch(() => {});
        await askNext(deps, handle, state);
        return;
      }

      case "stop":
        await ctx.answerCallbackQuery();
        await handle.end("cancelled");
        return;
    }
  });

  return composer;
}
