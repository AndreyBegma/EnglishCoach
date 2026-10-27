import { InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import type { BotContext } from "../bot/context";
import type { Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { applyReview, recordEvidence, reviewStatsSince } from "../db/repositories/cards";
import { getSettings } from "../db/repositories/users";
import { randomLemmas } from "../db/repositories/words";
import type { CardRow, CefrLevel, Language } from "../db/schema";
import type { WordImages } from "../images";
import { recordCardRating } from "../levels";
import { LlmOutputError, LlmProviderError, ProviderUnavailableError } from "../llm";
import type { Logger } from "../log";
import type { LearningHandle } from "../sessions/session-manager";
import type { SkillRunner } from "../skills";
import { encodeVocabCallback, type VocabCallback } from "./callbacks";
import { ExerciseCheckError, effectiveMode, exerciseVars, settleExercise } from "./exercise";
import { type Evidence, evidenceBits, isLearned, type MasteryContext } from "./mastery";
import type { VocabMode } from "./modes";
import { escapeHtml, exerciseHtml, HTML, type T } from "./render";
import { RATINGS, type RatingName, Scheduler } from "./scheduler";
import { earWaived, type SpeechPort } from "./speak";
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
   * Asks the LLM for one exercise on `card` and shows it: buttons for recognition and particle
   * choice, a typed answer otherwise. Returns false when the LLM failed (the learner was told and
   * offered a retry).
   */
  async sendExercise(
    handle: LearningHandle,
    ctx: BotContext,
    card: CardRow,
    requested: VocabMode,
    lead?: Lead,
  ): Promise<boolean> {
    const { level } = await this.settings(handle.user.id);
    const mode = effectiveMode(card, requested);
    const unitType = card.itemType === "user_word" ? "word" : card.itemType;
    const vars = exerciseVars(card, mode, {
      recent_accuracy: await this.recentAccuracy(handle),
      distractors:
        (mode === "recognition" || mode === "listening") && unitType !== "grammar_pattern"
          ? await randomLemmas(this.deps.db, level, card.front, DISTRACTOR_LEMMAS, unitType)
          : [],
    });
    const exercise = await this.llm(
      handle,
      ctx,
      { retry: "exercise", cardId: card.id },
      async () => {
        const run = await this.deps.skills.runSkill(handle.user.id, "vocab-exercise", vars);
        return settleExercise(vars, run.data);
      },
      lead,
    );
    if (!exercise) return false;

    const data = exercise;
    let text = exerciseHtml(data.instruction, data.prompt);
    let choiceMode: "recognition" | "listening" | "particle" =
      data.mode === "listening" || data.mode === "particle" ? data.mode : "recognition";
    if (data.mode === "listening") {
      // The model's words could give the word away: the server's own prompt goes with the audio.
      const t = this.t(handle);
      if (await this.playWord(handle, ctx, card)) {
        text = escapeHtml(t("vocab-listening-prompt"));
      } else {
        // Nothing could voice it after all: the same meanings, read instead of heard.
        choiceMode = "recognition";
        text = exerciseHtml(t("vocab-listening-unavailable"), `**${card.front}**`);
      }
    }
    const askedAt = this.now().getTime();
    if (data.options && data.correct_index !== null) {
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
        mode: choiceMode,
        options,
        correctIndex: data.correct_index,
        askedAt,
      });
      return true;
    }
    const typedMode =
      data.mode === "recognition" || data.mode === "listening" || data.mode === "particle"
        ? "production"
        : data.mode;
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
   * Sends the card's word as a voice note into the session (tracked, so cleanup deletes it).
   * False when there is no TTS, voice is off or nothing could voice it now.
   */
  private async playWord(handle: LearningHandle, ctx: BotContext, card: CardRow) {
    const { speech } = this.deps;
    const chatId = ctx.chat?.id;
    if (!speech || chatId === undefined || !ctx.settings.voiceEnabled) return false;
    try {
      const message = await speech.play(
        ctx.api,
        chatId,
        card.front,
        ctx.settings.englishVariant,
        handle.user.id,
      );
      await handle.track(message.message_id);
      return true;
    } catch (error) {
      this.deps.log.warn("listening exercise could not be voiced", {
        userId: handle.user.id,
        cardId: card.id,
        error: error instanceof Error ? error.message : "unknown error",
      });
      return false;
    }
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
    evidence: readonly Evidence[] = [],
  ): Promise<boolean> {
    const { db } = this.deps;
    const now = this.now();
    const { next, log } = this.scheduler.rate(card, rating, now);
    if (!(await applyReview(db, card.id, card.reps, next, log))) return false;
    const { timezone } = await this.settings(handle.user.id);
    await addVocabStats(db, handle.user.id, localDate(now, timezone), { [counter]: 1 });
    const learned = rating !== "again" && (await this.recordMastery(handle, card, evidence, now));
    await recordCardRating(db, handle.user.id, card, rating, { learned });
    return true;
  }

  /**
   * Whether listening evidence is waived for `card`: the learner cannot be asked by ear (see
   * `earWaived`).
   */
  async masteryContext(userId: number, card: Pick<CardRow, "front">): Promise<MasteryContext> {
    const settings = await getSettings(this.deps.db, userId);
    return {
      earWaived: await earWaived(
        this.deps.speech,
        {
          voiceEnabled: settings?.voiceEnabled ?? false,
          englishVariant: settings?.englishVariant ?? "us",
        },
        card,
        userId,
      ),
    };
  }

  /**
   * Keeps the evidence a passing rating confirmed and applies the learned rule to the rated card.
   * True when this rating made the card learned. Grammar patterns are not words.
   */
  private async recordMastery(
    handle: LearningHandle,
    card: CardRow,
    evidence: readonly Evidence[],
    now: Date,
  ): Promise<boolean> {
    if (card.itemType === "grammar_pattern") return false;
    const context = await this.masteryContext(handle.user.id, card);
    return recordEvidence(
      this.deps.db,
      card.id,
      evidenceBits(evidence),
      (updated) => isLearned(updated, context),
      now,
    );
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
      if (
        error instanceof LlmOutputError ||
        error instanceof LlmProviderError ||
        error instanceof ExerciseCheckError
      ) {
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
