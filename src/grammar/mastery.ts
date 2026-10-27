import { type Card, createEmptyCard, fsrs, Rating, type State } from "ts-fsrs";
import type { TopicFsrs, TopicItem, TopicProgressRow, TopicStatus } from "../db/schema";

/**
 * Topic mastery, pure: how one graded item or one correct use in free production moves a
 * learner's progress on a syllabus topic. Nothing here reads or writes the database; the recorder
 * (`./progress.ts`) locks the row, calls these and stores the result.
 *
 * not_started → learning on the first graded item. learning/shaky → mastered when `masteryRule`
 * holds; the topic then enters FSRS. mastered → shaky when its rolling accuracy falls below the
 * threshold. A due mastered topic is checked by its next `CHECK_ITEMS` items: all of them right
 * reschedules it, a wrong one sends it back to learning.
 */

/** The rolling window: mastery is judged on this many most recent items. */
export const MASTERY_WINDOW = 8;
/** Mean score over the window a mastered topic needs, and keeps. */
export const MASTERY_ACCURACY = 0.85;
/** The window must span at least this many exercise types. */
export const MASTERY_TYPES = 2;
/** The accuracy rule must still hold on an item at least this long after it first held. */
export const CONFIRMATION_MS = 3 * 24 * 60 * 60 * 1000;
/** Correct uses in free production a topic needs before it can be mastered. */
export const MASTERY_TRANSFER = 1;
/** Items that make up the check of a due mastered topic. */
export const CHECK_ITEMS = 3;

/** The parts of a `topic_progress` row the rules read and write. */
export type TopicProgress = Pick<
  TopicProgressRow,
  | "status"
  | "recentItems"
  | "accuracyByType"
  | "transferEvidence"
  | "criteriaMetAt"
  | "confirmedAt"
  | "masteredAt"
  | "firstMasteredAt"
  | "fsrs"
  | "reviewDue"
  | "checkScores"
>;

export const EMPTY_PROGRESS: TopicProgress = {
  status: "not_started",
  recentItems: [],
  accuracyByType: {},
  transferEvidence: 0,
  criteriaMetAt: null,
  confirmedAt: null,
  masteredAt: null,
  firstMasteredAt: null,
  fsrs: null,
  reviewDue: null,
  checkScores: [],
};

/** The rules' part of a stored row, nothing else. */
export function progressOf(row: TopicProgress): TopicProgress {
  return {
    status: row.status,
    recentItems: row.recentItems,
    accuracyByType: row.accuracyByType,
    transferEvidence: row.transferEvidence,
    criteriaMetAt: row.criteriaMetAt,
    confirmedAt: row.confirmedAt,
    masteredAt: row.masteredAt,
    firstMasteredAt: row.firstMasteredAt,
    fsrs: row.fsrs,
    reviewDue: row.reviewDue,
    checkScores: row.checkScores,
  };
}

/** What a step did, besides the new progress. */
export type TopicStep = {
  progress: TopicProgress;
  /** The status before the step. */
  from: TopicStatus;
  /** The topic became mastered on this step. */
  mastered: boolean;
  /** …and it had never been mastered before. */
  firstMastery: boolean;
  /** A due check finished on this step: the FSRS rating it gave. */
  checked?: "passed" | "failed";
};

// Topics are reviewed in days, not minutes: no short-term learning steps.
const scheduler = fsrs({ enable_short_term: false });

function toCard(stored: TopicFsrs): Card {
  const card: Card = {
    due: new Date(stored.due),
    stability: stored.stability,
    difficulty: stored.difficulty,
    elapsed_days: stored.elapsedDays,
    scheduled_days: stored.scheduledDays,
    learning_steps: stored.learningSteps,
    reps: stored.reps,
    lapses: stored.lapses,
    state: stored.state as State,
  };
  if (stored.lastReview) card.last_review = new Date(stored.lastReview);
  return card;
}

function fromCard(card: Card): TopicFsrs {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.toISOString() ?? null,
  };
}

/** Rates the topic's card (a new one on first mastery) and returns the stored card and its due. */
function schedule(
  stored: TopicFsrs | null,
  rating: Rating.Again | Rating.Hard | Rating.Good,
  at: Date,
) {
  const card = stored ? toCard(stored) : createEmptyCard(at);
  const next = scheduler.next(card, at, rating).card;
  return { fsrs: fromCard(next), reviewDue: next.due };
}

const mean = (scores: readonly number[]) =>
  scores.length === 0 ? 0 : scores.reduce((sum, s) => sum + s, 0) / scores.length;

/** Mean score per exercise type over `items`. */
export function accuracyByType(items: readonly TopicItem[]): Record<string, number> {
  const byType = new Map<string, number[]>();
  for (const item of items) byType.set(item.type, [...(byType.get(item.type) ?? []), item.score]);
  return Object.fromEntries([...byType].map(([type, scores]) => [type, mean(scores)]));
}

/** Whether the window alone meets the accuracy rule: full, accurate enough, varied enough. */
export function windowHolds(items: readonly TopicItem[]): boolean {
  return (
    items.length >= MASTERY_WINDOW &&
    mean(items.map((item) => item.score)) >= MASTERY_ACCURACY &&
    new Set(items.map((item) => item.type)).size >= MASTERY_TYPES
  );
}

/**
 * The mastery rule, in one place (C-58 replaces it): the accuracy rule holds over the window, it
 * was confirmed on an item at least `CONFIRMATION_MS` after it first held, and the topic has been
 * used correctly in free production. Everything it needs is on `progress`.
 */
export function masteryRule(progress: TopicProgress): boolean {
  return (
    windowHolds(progress.recentItems) &&
    progress.confirmedAt !== null &&
    progress.transferEvidence >= MASTERY_TRANSFER
  );
}

/** Moves the confirmation clock after the window changed at `at`. */
function trackCriteria(progress: TopicProgress, at: Date): TopicProgress {
  if (!windowHolds(progress.recentItems)) {
    return { ...progress, criteriaMetAt: null, confirmedAt: null };
  }
  const criteriaMetAt = progress.criteriaMetAt ?? at;
  const confirmedAt =
    progress.confirmedAt ?? (at.getTime() - criteriaMetAt.getTime() >= CONFIRMATION_MS ? at : null);
  return { ...progress, criteriaMetAt, confirmedAt };
}

/** Masters a learning or shaky topic when the rule holds: it enters (or re-enters) FSRS. */
function promote(progress: TopicProgress, from: TopicStatus, at: Date): TopicStep {
  if (progress.status === "mastered" || !masteryRule(progress)) {
    return { progress, from, mastered: false, firstMastery: false };
  }
  const firstMastery = progress.firstMasteredAt === null;
  return {
    progress: {
      ...progress,
      status: "mastered",
      masteredAt: at,
      firstMasteredAt: progress.firstMasteredAt ?? at,
      checkScores: [],
      ...schedule(progress.fsrs, Rating.Good, at),
    },
    from,
    mastered: true,
    firstMastery,
  };
}

/** A failed check or a fall below the threshold: the confirmation has to be earned again. */
const demoted = (progress: TopicProgress, status: TopicStatus): TopicProgress => ({
  ...progress,
  status,
  criteriaMetAt: null,
  confirmedAt: null,
  masteredAt: null,
  checkScores: [],
});

/** Whether a mastered topic's review is due at `at`. */
export function isDue(progress: TopicProgress, at: Date): boolean {
  return (
    progress.status === "mastered" &&
    progress.reviewDue !== null &&
    progress.reviewDue.getTime() <= at.getTime()
  );
}

/** One graded item on the topic: `score` 0..1, `type` the grammar-quiz item type. */
export function applyItem(
  before: TopicProgress,
  item: { type: string; score: number },
  at: Date,
): TopicStep {
  const from = before.status;
  const score = Math.min(1, Math.max(0, item.score));
  const recentItems = [
    ...before.recentItems,
    { type: item.type, score, at: at.toISOString() },
  ].slice(-MASTERY_WINDOW);
  let progress = trackCriteria(
    {
      ...before,
      status: from === "not_started" ? "learning" : from,
      recentItems,
      accuracyByType: accuracyByType(recentItems),
    },
    at,
  );

  let checked: TopicStep["checked"];
  if (isDue(before, at)) {
    // A wrong answer fails the check at once; partial credit passes, but rates the card Hard.
    if (score === 0) {
      progress = demoted({ ...progress, ...schedule(progress.fsrs, Rating.Again, at) }, "learning");
      return { progress, from, mastered: false, firstMastery: false, checked: "failed" };
    }
    const checkScores = [...progress.checkScores, score];
    if (checkScores.length < CHECK_ITEMS) {
      return { progress: { ...progress, checkScores }, from, mastered: false, firstMastery: false };
    }
    const rating = checkScores.every((s) => s >= 1) ? Rating.Good : Rating.Hard;
    progress = { ...progress, checkScores: [], ...schedule(progress.fsrs, rating, at) };
    checked = "passed";
  }

  if (progress.status === "mastered") {
    const below = mean(recentItems.map((i) => i.score)) < MASTERY_ACCURACY;
    return {
      progress: below ? demoted(progress, "shaky") : progress,
      from,
      mastered: false,
      firstMastery: false,
      ...(checked ? { checked } : {}),
    };
  }
  return promote(progress, from, at);
}

/** `uses` correct uses of the topic in free production at `at`. */
export function applyTransfer(before: TopicProgress, uses: number, at: Date): TopicStep {
  const progress = { ...before, transferEvidence: before.transferEvidence + Math.max(0, uses) };
  return promote(progress, before.status, at);
}
