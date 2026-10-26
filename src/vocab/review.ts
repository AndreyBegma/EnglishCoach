import { InlineKeyboard } from "grammy";
import type { BotContext } from "../bot/context";
import {
  countDueSince,
  findMistakeForCard,
  findNextDueCard,
  getCard,
  reviewStatsSince,
} from "../db/repositories/cards";
import type { CardRow } from "../db/schema";
import type { LearningHandle, SessionKindHandler } from "../sessions/session-manager";
import type { VocabCallback } from "./callbacks";
import { button, isLlmFailure, type VocabCore } from "./core";
import { modeFor } from "./modes";
import { escapeHtml, HTML } from "./render";
import type { RatingName } from "./scheduler";
import { speakRow } from "./speak";
import { readFlow, type VocabStep, writeFlow } from "./state";

/** At most this many cards per Review session; the rest wait for the next one. */
export const REVIEW_CAP = 50;
/** An exact answer faster than this (seconds) suggests Easy rather than Good. */
const EASY_UNDER_SECONDS = 6;

type Typed = Extract<VocabStep, { kind: "typed" }>;

/** Lower case, single spaces, no surrounding punctuation: how typed answers are compared. */
export function normaliseAnswer(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”‘’.,!?;:()]+|[\s"'“”‘’.,!?;:()]+$/g, "");
}

/**
 * Review (`review`): due cards, earliest first, at most `REVIEW_CAP`. Words rotate through
 * recognition, production and cloze as their stability grows; grammar patterns are corrected and
 * self-graded. The server judges what it can, the LLM judges the rest, and the learner applies the
 * suggested rating or overrides it — the one FSRS write per card.
 */
export class ReviewFlow implements SessionKindHandler {
  constructor(private readonly core: VocabCore) {}

  async onStart(handle: LearningHandle, ctx?: BotContext): Promise<void> {
    const t = this.core.t(handle);
    const due = await countDueSince(
      this.core.deps.db,
      handle.user.id,
      this.core.now(),
      handle.session.startedAt,
    );
    if (due === 0 || !ctx) {
      if (!ctx) {
        this.core.deps.log.warn("review started outside an update", { userId: handle.user.id });
      }
      await this.core.finish(handle, ctx, "vocab-review-nothing");
      return;
    }
    await handle.send(t("vocab-review-header", { count: Math.min(due, REVIEW_CAP) }), {
      reply_markup: InlineKeyboard.from([
        [button(t("vocab-start"), { op: "start" }), button(t("vocab-finish"), { op: "finish" })],
      ]),
    });
    writeFlow(ctx, handle.session.id, { kind: "idle" });
  }

  async onMessage(handle: LearningHandle, ctx: BotContext): Promise<void> {
    const step = readFlow(ctx, handle.session.id);
    if (step?.kind !== "typed") {
      await handle.send(this.core.t(handle)("vocab-use-buttons"));
      return;
    }
    await this.judgeTyped(handle, ctx, step, ctx.message?.text ?? "");
  }

  accepts(handle: LearningHandle, ctx: BotContext, callback: VocabCallback): boolean {
    const step = readFlow(ctx, handle.session.id);
    switch (callback.op) {
      case "start":
        return step?.kind === "idle";
      case "choice":
      case "rate":
      case "reveal": {
        const expected = { choice: "choice", rate: "rate", reveal: "reveal" }[callback.op];
        return step?.kind === expected && "cardId" in step && step.cardId === callback.cardId;
      }
      case "retry":
        return step?.kind === "failed";
      case "finish":
        return true;
      default:
        return false;
    }
  }

  async onCallback(handle: LearningHandle, ctx: BotContext, callback: VocabCallback) {
    const step = readFlow(ctx, handle.session.id);
    switch (callback.op) {
      case "start":
        await this.next(handle, ctx);
        return;
      case "choice":
        if (step?.kind === "choice") {
          const correct = callback.index === step.correctIndex;
          const answer = escapeHtml(step.options[step.correctIndex] ?? "");
          const t = this.core.t(handle);
          await this.feedback(
            handle,
            ctx,
            step.cardId,
            correct ? t("vocab-review-right") : t("vocab-review-wrong", { answer }),
            // Picking from four options is the easiest recall: never more than Good.
            correct ? "good" : "again",
          );
        }
        return;
      case "reveal":
        await this.reveal(handle, ctx, callback.cardId);
        return;
      case "rate": {
        const card = await getCard(this.core.deps.db, handle.user.id, callback.cardId);
        if (card && (await this.core.rate(handle, card, callback.rating, "reviews"))) {
          await this.next(handle, ctx);
        }
        return;
      }
      case "retry":
        await this.core.dismissFailure(ctx, handle);
        if (step?.kind === "failed" && step.retry === "exercise" && step.cardId) {
          const card = await getCard(this.core.deps.db, handle.user.id, step.cardId);
          if (card) {
            await this.ask(handle, ctx, card);
            return;
          }
        }
        await this.next(handle, ctx);
        return;
      case "finish":
        await this.core.finish(handle, ctx, "vocab-review-nothing");
        return;
    }
  }

  /** The next due card, or the end of the session when none is left or the cap is reached. */
  private async next(handle: LearningHandle, ctx: BotContext): Promise<void> {
    const { db } = this.core.deps;
    const since = handle.session.startedAt;
    const stats = await reviewStatsSince(db, handle.user.id, since);
    const card =
      stats.learned + stats.reviewed < REVIEW_CAP
        ? await findNextDueCard(db, handle.user.id, this.core.now(), since)
        : undefined;
    if (!card) {
      await this.core.finish(handle, ctx, "vocab-review-nothing");
      return;
    }
    await this.ask(handle, ctx, card);
  }

  private async ask(handle: LearningHandle, ctx: BotContext, card: CardRow): Promise<void> {
    if (card.itemType === "grammar_pattern") {
      await this.askPattern(handle, ctx, card);
      return;
    }
    await this.core.sendExercise(handle, ctx, card, modeFor(card));
  }

  /** Error correction: the learner fixes the wrong sentence in their head, then checks. */
  private async askPattern(handle: LearningHandle, ctx: BotContext, card: CardRow) {
    const t = this.core.t(handle);
    const mistake = await findMistakeForCard(this.core.deps.db, card.id);
    const sentence = mistake?.exampleWrong ?? card.front;
    await handle.send(`${t("vocab-pattern-prompt")}\n<i>${escapeHtml(sentence)}</i>`, {
      ...HTML,
      reply_markup: InlineKeyboard.from([
        [button(t("vocab-pattern-reveal"), { op: "reveal", cardId: card.id })],
      ]),
    });
    writeFlow(ctx, handle.session.id, { kind: "reveal", cardId: card.id });
  }

  private async reveal(handle: LearningHandle, ctx: BotContext, cardId: number) {
    const t = this.core.t(handle);
    const mistake = await findMistakeForCard(this.core.deps.db, cardId);
    const card = mistake ? undefined : await getCard(this.core.deps.db, handle.user.id, cardId);
    const right = mistake?.exampleRight ?? card?.backJson.translation ?? "";
    const lines = [t("vocab-pattern-answer", { sentence: escapeHtml(right) })];
    if (mistake?.explanation) lines.push(escapeHtml(mistake.explanation));
    lines.push("", t("vocab-rate-prompt"));
    await handle.send(lines.join("\n"), {
      ...HTML,
      reply_markup: this.core.ratingKeyboard(t, cardId),
    });
    writeFlow(ctx, handle.session.id, { kind: "rate", cardId });
  }

  /**
   * A typed answer: an exact match is judged here, anything else by `vocab-check`. The server maps
   * the verdict to the suggested rating; the model's own rating only refines a correct answer.
   */
  private async judgeTyped(handle: LearningHandle, ctx: BotContext, step: Typed, text: string) {
    const t = this.core.t(handle);
    const card = await getCard(this.core.deps.db, handle.user.id, step.cardId);
    if (!card) return;
    const answer = normaliseAnswer(text);
    const target = escapeHtml(step.accepted[0] ?? card.front);

    if (step.accepted.some((accepted) => normaliseAnswer(accepted) === answer)) {
      await this.feedback(
        handle,
        ctx,
        card.id,
        t("vocab-review-right"),
        this.fastOrGood(step.askedAt),
      );
      return;
    }

    const responseSeconds = (this.core.now().getTime() - step.askedAt) / 1000;
    try {
      const { data } = await this.core.deps.skills.runSkill(handle.user.id, "vocab-check", {
        mode: step.mode,
        lemma: card.front,
        prompt: step.prompt,
        accepted_answers: step.accepted,
        learner_answer: text,
        response_seconds: responseSeconds >= 0 ? responseSeconds : null,
      });
      const suggested: RatingName =
        data.verdict === "wrong"
          ? "again"
          : data.verdict === "close"
            ? "hard"
            : data.suggested_rating === "again"
              ? "good"
              : data.suggested_rating;
      const head =
        data.verdict === "wrong"
          ? t("vocab-review-wrong", { answer: target })
          : t("vocab-review-right");
      await this.feedback(handle, ctx, card.id, `${head}\n${escapeHtml(data.feedback)}`, suggested);
    } catch (error) {
      if (!isLlmFailure(error)) throw error;
      // Without a judge the learner still sees the answer and grades themselves.
      this.core.deps.log.warn("vocabulary answer check failed", {
        userId: handle.user.id,
        sessionId: handle.session.id,
        error: error.message,
      });
      await this.feedback(handle, ctx, card.id, t("vocab-check-unavailable", { answer: target }));
    }
  }

  private async feedback(
    handle: LearningHandle,
    ctx: BotContext,
    cardId: number,
    text: string,
    suggested?: RatingName,
  ) {
    const t = this.core.t(handle);
    await handle.send(`${text}\n\n${t("vocab-rate-prompt")}`, {
      ...HTML,
      reply_markup: this.core.ratingKeyboard(t, cardId, suggested, speakRow(t, ctx, cardId)),
    });
    writeFlow(ctx, handle.session.id, { kind: "rate", cardId, suggested });
  }

  private fastOrGood(askedAt: number): RatingName {
    const seconds = (this.core.now().getTime() - askedAt) / 1000;
    return seconds >= 0 && seconds < EASY_UNDER_SECONDS ? "easy" : "good";
  }
}
