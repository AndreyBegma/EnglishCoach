import { type Card, createEmptyCard, fsrs, Rating, type State } from "ts-fsrs";
import type {
  TopicFsrs,
  TopicItem,
  TopicProgressRow,
  TopicSession,
  TopicStatus,
} from "../db/schema";

/**
 * Topic mastery, pure: how one graded item, or one correct use of or error against the topic in
 * free production, moves a learner's progress on a syllabus topic. Nothing here reads or writes
 * the database; the recorder (`./progress.ts`) locks the row, calls these and stores the result.
 *
 * not_started → learning on the first graded item. learning/shaky → mastered when `masteryRule`
 * holds; the topic then enters FSRS. mastered → shaky when its rolling accuracy falls below the
 * threshold or an error is tagged to it in free production. A due mastered topic is checked by
 * its next `CHECK_ITEMS` items: all of them right reschedules it, a wrong one sends it back to
 * learning.
 */

/** The rolling window a mastered topic's accuracy is watched over. */
export const MASTERY_WINDOW = 8;
/** Accuracy each counted session needs, and the window keeps once mastered. */
export const MASTERY_ACCURACY = 0.85;
/** The counted sessions must span at least this many exercise types. */
export const MASTERY_TYPES = 2;
/** Mastery is judged on this many most recent grammar sessions on the topic. */
export const MASTERY_SESSIONS = 3;
/** …the first and the last of which are at least this far apart. */
export const MASTERY_SPREAD_MS = 7 * 24 * 60 * 60 * 1000;
/** Correct uses in free production a topic needs before it can be mastered. */
export const MASTERY_TRANSFER = 2;
/** No error tagged to the topic in free production for this long before it can be mastered. */
export const ERROR_FREE_MS = 14 * 24 * 60 * 60 * 1000;
/** Items that make up the check of a due mastered topic. */
export const CHECK_ITEMS = 3;

/** The parts of a `topic_progress` row the rules read and write. */
export type TopicProgress = Pick<
  TopicProgressRow,
  | "status"
  | "recentItems"
  | "accuracyByType"
  | "sessionResults"
  | "transferEvidence"
  | "lastErrorAt"
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
  sessionResults: [],
  transferEvidence: 0,
  lastErrorAt: null,
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
    sessionResults: row.sessionResults,
    transferEvidence: row.transferEvidence,
    lastErrorAt: row.lastErrorAt,
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

/**
 * Whether the practice half of the rule holds: the last `MASTERY_SESSIONS` sessions on the topic
 * are each at least `MASTERY_ACCURACY`, spread over at least `MASTERY_SPREAD_MS`, and together
 * span at least `MASTERY_TYPES` exercise types.
 */
export function sessionsHold(sessions: readonly TopicSession[]): boolean {
  const counted = sessions.slice(-MASTERY_SESSIONS);
  const first = counted[0];
  const last = counted.at(-1);
  if (counted.length < MASTERY_SESSIONS || !first || !last) return false;
  return (
    counted.every((s) => s.items > 0 && s.scoreSum / s.items >= MASTERY_ACCURACY) &&
    Date.parse(last.at) - Date.parse(first.at) >= MASTERY_SPREAD_MS &&
    new Set(counted.flatMap((s) => s.types)).size >= MASTERY_TYPES
  );
}

/**
 * Whether the transfer half of the rule holds at `at`: enough correct uses in free production, and
 * no error tagged to the topic there in the last `ERROR_FREE_MS`.
 */
export function transferHolds(progress: TopicProgress, at: Date): boolean {
  return (
    progress.transferEvidence >= MASTERY_TRANSFER &&
    (progress.lastErrorAt === null ||
      at.getTime() - progress.lastErrorAt.getTime() >= ERROR_FREE_MS)
  );
}

/**
 * The mastery rule, in one place: `sessionsHold` and `transferHolds`. Everything it needs is on
 * `progress`; `at` is now, for the error-free window.
 */
export function masteryRule(progress: TopicProgress, at: Date): boolean {
  return sessionsHold(progress.sessionResults) && transferHolds(progress, at);
}

/** `sessionResults` with one more item of session `session`, at most `MASTERY_SESSIONS` kept. */
function addToSession(
  sessions: readonly TopicSession[],
  item: { type: string; score: number; session: number },
  at: Date,
): TopicSession[] {
  const current = sessions.find((s) => s.session === item.session);
  const updated: TopicSession = current
    ? {
        ...current,
        scoreSum: current.scoreSum + item.score,
        items: current.items + 1,
        types: current.types.includes(item.type) ? current.types : [...current.types, item.type],
      }
    : {
        session: item.session,
        at: at.toISOString(),
        scoreSum: item.score,
        items: 1,
        types: [item.type],
      };
  return [...sessions.filter((s) => s.session !== item.session), updated]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-MASTERY_SESSIONS);
}

/** Masters a learning or shaky topic when the rule holds: it enters (or re-enters) FSRS. */
function promote(progress: TopicProgress, from: TopicStatus, at: Date): TopicStep {
  if (progress.status === "mastered" || !masteryRule(progress, at)) {
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

/**
 * A failed check, a fall below the threshold or an error in free production: mastery has to be
 * earned again under the full rule.
 */
const demoted = (progress: TopicProgress, status: TopicStatus): TopicProgress => ({
  ...progress,
  status,
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

/**
 * One graded item on the topic: `score` 0..1, `type` the grammar-quiz item type, `session` the
 * learning session it was answered in.
 */
export function applyItem(
  before: TopicProgress,
  item: { type: string; score: number; session: number },
  at: Date,
): TopicStep {
  const from = before.status;
  const score = Math.min(1, Math.max(0, item.score));
  const recentItems = [
    ...before.recentItems,
    { type: item.type, score, at: at.toISOString() },
  ].slice(-MASTERY_WINDOW);
  let progress: TopicProgress = {
    ...before,
    status: from === "not_started" ? "learning" : from,
    recentItems,
    accuracyByType: accuracyByType(recentItems),
    sessionResults: addToSession(before.sessionResults, { ...item, score }, at),
  };

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

/**
 * One correct use of the topic in free production, or one error against it, at `at`. A correct use
 * is evidence and may master the topic; an error restarts the error-free window and turns a
 * mastered topic shaky.
 */
export function applyTransfer(
  before: TopicProgress,
  kind: "correct" | "error",
  at: Date,
): TopicStep {
  const from = before.status;
  if (kind === "correct") {
    return promote({ ...before, transferEvidence: before.transferEvidence + 1 }, from, at);
  }
  const lastErrorAt =
    before.lastErrorAt && before.lastErrorAt.getTime() > at.getTime() ? before.lastErrorAt : at;
  const progress = { ...before, lastErrorAt };
  return {
    progress: from === "mastered" ? demoted(progress, "shaky") : progress,
    from,
    mastered: false,
    firstMastery: false,
  };
}

/**
 * A topic the placement test found known: mastered at `at` and on FSRS like an earned mastery,
 * so its first check comes due. It earns nothing: `firstMasteredAt` stays as it was, so the
 * first mastery the learner earns later still pays its XP, and no `topic.mastered` is emitted.
 */
export function placeMastered(before: TopicProgress, at: Date): TopicProgress {
  return {
    ...before,
    status: "mastered",
    masteredAt: at,
    checkScores: [],
    ...schedule(before.fsrs, Rating.Good, at),
  };
}
