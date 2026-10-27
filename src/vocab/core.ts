import { InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import type { BotContext } from "../bot/context";
import type { Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { applyReview, reviewStatsSince } from "../db/repositories/cards";
import { getSettings } from "../db/repositories/users";
import { randomLemmas } from "../db/repositories/words";
import type { CardRow, CefrLevel, Language } from "../db/schema";
import type { WordImages } from "../images";
import { LlmOutputError, LlmProviderError, ProviderUnavailableError } from "../llm";
import type { Logger } from "../log";
import type { LearningHandle } from "../sessions/session-manager";
import type { SkillRunner } from "../skills";
import { encodeVocabCallback, type VocabCallback } from "./callbacks";
import type { VocabMode } from "./modes";
import { exampleText, exerciseHtml, HTML, type T } from "./render";
import { RATINGS, type RatingName, Scheduler } from "./scheduler";
import type { SpeechPort } from "./speak";
import { clearFlow, writeFlow } from "./state";
import { addVocabStats, localDate } from "./stats";

/**
 * What the previous step leaves on the next screen: its result as the first line (HTML), and
 * buttons that act on it (Undo) above the new step's own.
 */
export interface Lead {
  line: string;
  rows?: InlineKeyboardButton[][];
}

export interface VocabDeps {
  db: Db;
  i18n: Translator;
  skills: SkillRunner;
  log: Logger;
  /** Pictures for word cards; absent when no stock-photo key is set. */
  images?: WordImages;
  /** Text to speech, for the 🔊 buttons; absent means no 🔊 on any card. */
  speech?: SpeechPort;
  /** The clock; tests pin it. */
  now?: () => Date;
}

/** Level for learners who have not taken the placement test yet. */
export const DEFAULT_LEVEL: CefrLevel = "A1";
/** Recent accuracy is only a signal once the session has this many ratings. */
const ACCURACY_MIN_RATINGS = 3;
const DISTRACTOR_LEMMAS = 6;
/** Telegram shows long button labels cut off; options longer than this are shortened. */
const MAX_OPTION_LABEL = 60;

export interface LearnerSettings {
  level: CefrLevel;
  explainLang: Language;
  timezone: string;
  wordsPerDay: number;
}

export const button = (label: string, callback: VocabCallback) =>
  InlineKeyboard.text(label, encodeVocabCallback(callback));

/** The LLM could not be used or did not answer usefully — not a bug in the caller. */
export const isLlmFailure = (
  error: unknown,
): error is LlmOutputError | LlmProviderError | ProviderUnavailableError =>
  error instanceof LlmOutputError ||
  error instanceof LlmProviderError ||
  error instanceof ProviderUnavailableError;

const label = (text: string) =>
  text.length > MAX_OPTION_LABEL ? `${text.slice(0, MAX_OPTION_LABEL - 1)}…` : text;

/** What both vocabulary sessions share: settings, exercises, ratings, LLM failures, the summary. */
export class VocabCore {
  readonly scheduler = new Scheduler();

  constructor(readonly deps: VocabDeps) {}

  now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  t(handle: LearningHandle): T {
    return (key, variables) => this.deps.i18n.t(handle.locale, key, variables);
  }

  async settings(userId: number): Promise<LearnerSettings> {
    const settings = await getSettings(this.deps.db, userId);
    return {
      level: settings?.cefrLevel ?? DEFAULT_LEVEL,
      explainLang: settings?.explainLang ?? "en",
      timezone: settings?.timezone ?? "UTC",
      wordsPerDay: settings?.wordsPerDay ?? 5,
    };
  }

  /** Share of passed ratings so far in this session; null until there are enough of them. */
  private async recentAccuracy(handle: LearningHandle): Promise<number | null> {
    const stats = await reviewStatsSince(this.deps.db, handle.user.id, handle.session.startedAt);
    const total = stats.learned + stats.reviewed;
    return total >= ACCURACY_MIN_RATINGS ? stats.passed / total : null;
  }

  /** Shows `text` (HTML) in the session window, below the previous step's result. */
  async show(
    handle: LearningHandle,
    text: string,
    rows: InlineKeyboardButton[][] = [],
    lead?: Lead,
  ): Promise<void> {
    const keyboard = [...(lead?.rows ?? []), ...rows];
    await handle.window.show({
      text: lead ? `${lead.line}\n\n${text}` : text,
      ...HTML,
      reply_markup: keyboard.length ? InlineKeyboard.from(keyboard) : undefined,
    });
  }

  /**
   * Asks the LLM for one exercise on `card` and shows it: buttons for recognition, a typed answer
   * otherwise. Returns false when the LLM failed (the learner was told and offered a retry).
   */
  async sendExercise(
    handle: LearningHandle,
    ctx: BotContext,
    card: CardRow,
    mode: VocabMode,
    lead?: Lead,
  ): Promise<boolean> {
    const { level } = await this.settings(handle.user.id);
    const back = card.backJson;
    const vars = {
      mode,
      recent_accuracy: await this.recentAccuracy(handle),
      lemma: card.front,
      pos: back.pos ?? null,
      translation: back.translation ?? null,
      examples: back.examples?.map(exampleText) ?? [],
      distractors:
        mode === "recognition"
          ? await randomLemmas(this.deps.db, level, card.front, DISTRACTOR_LEMMAS)
          : [],
    };
    const exercise = await this.llm(
      handle,
      ctx,
      { retry: "exercise", cardId: card.id },
      () => this.deps.skills.runSkill(handle.user.id, "vocab-exercise", vars),
      lead,
    );
    if (!exercise) return false;

    const { data } = exercise;
    const text = exerciseHtml(data.instruction, data.prompt);
    const askedAt = this.now().getTime();
    if (data.mode === "recognition" && data.options && data.correct_index !== null) {
      const options = data.options;
      await this.show(
        handle,
        text,
        options.map((option, index) => [
          button(label(option), { op: "choice", cardId: card.id, index }),
        ]),
        lead,
      );
      writeFlow(ctx, handle.session.id, {
        kind: "choice",
        cardId: card.id,
        options,
        correctIndex: data.correct_index,
        askedAt,
      });
      return true;
    }
    const typedMode = data.mode === "cloze" ? "cloze" : "production";
    await this.show(handle, text, [], lead);
    writeFlow(ctx, handle.session.id, {
      kind: "typed",
      cardId: card.id,
      mode: typedMode,
      prompt: data.prompt,
      accepted: data.accepted_answers,
      askedAt,
    });
    return true;
  }

  /**
   * Applies a rating with FSRS and counts it on today's stats. False when the card was rated in
   * the meantime (a double tap): nothing is written then.
   */
  async rate(
    handle: LearningHandle,
    card: CardRow,
    rating: RatingName,
    counter: "newWords" | "reviews",
  ): Promise<boolean> {
    const now = this.now();
    const { next, log } = this.scheduler.rate(card, rating, now);
    if (!(await applyReview(this.deps.db, card.id, card.reps, next, log))) return false;
    const { timezone } = await this.settings(handle.user.id);
    await addVocabStats(this.deps.db, handle.user.id, localDate(now, timezone), { [counter]: 1 });
    return true;
  }

  /** Again · Hard · Good · Easy, the suggestion marked. */
  ratingKeyboard(
    t: T,
    cardId: number,
    suggested?: RatingName,
    extraRows: InlineKeyboardButton[][] = [],
  ): InlineKeyboard {
    return InlineKeyboard.from([
      ...extraRows,
      RATINGS.map((rating) =>
        button(`${rating === suggested ? "✓ " : ""}${t(`vocab-rate-${rating}`)}`, {
          op: "rate",
          cardId,
          rating,
        }),
      ),
    ]);
  }

  /**
   * Runs an LLM call. A provider the user cannot use, or a failed call, is reported in the
   * session window (with Retry where retrying can help) and undefined comes back; nothing is
   * written. The failure is a step like any other, so it replaces whatever was on screen.
   */
  async llm<R>(
    handle: LearningHandle,
    ctx: BotContext,
    failed: { retry: "next" | "exercise"; cardId?: number },
    run: () => Promise<R>,
    lead?: Lead,
  ): Promise<R | undefined> {
    const t = this.t(handle);
    try {
      return await run();
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        await this.show(
          handle,
          t(error.i18nKey),
          [[button(t("vocab-finish"), { op: "finish" })]],
          lead,
        );
        writeFlow(ctx, handle.session.id, { kind: "idle" });
        return undefined;
      }
      if (error instanceof LlmOutputError || error instanceof LlmProviderError) {
        this.deps.log.warn("vocabulary LLM call failed", {
          userId: handle.user.id,
          sessionId: handle.session.id,
          error: error.message,
        });
        await this.show(
          handle,
          t("vocab-llm-failed"),
          [
            [
              button(t("vocab-retry"), { op: "retry" }),
              button(t("vocab-finish"), { op: "finish" }),
            ],
          ],
          lead,
        );
        writeFlow(ctx, handle.session.id, { kind: "failed", ...failed });
        return undefined;
      }
      throw error;
    }
  }

  /** Ends the session with a summary computed from what was rated in it. */
  async finish(handle: LearningHandle, ctx: BotContext | undefined, emptyKey: string) {
    const t = this.t(handle);
    const stats = await reviewStatsSince(this.deps.db, handle.user.id, handle.session.startedAt);
    const total = stats.learned + stats.reviewed;
    const parts: string[] = [];
    if (stats.learned) parts.push(t("vocab-summary-new", { count: stats.learned }));
    if (stats.reviewed) parts.push(t("vocab-summary-reviewed", { count: stats.reviewed }));
    if (total) {
      parts.push(
        t("vocab-summary-accuracy", { percent: Math.round((stats.passed / total) * 100) }),
      );
    }
    if (ctx) clearFlow(ctx);
    await handle.end("finished", {
      line: parts.length ? parts.join(" · ") : t(emptyKey),
      learned: stats.learned,
      reviewed: stats.reviewed,
      passed: stats.passed,
    });
  }
}
