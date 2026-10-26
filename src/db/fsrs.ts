import type { Card, Rating, ReviewLog, State } from "ts-fsrs";
import type { CardRow, ReviewLogRow } from "./schema";

/** The FSRS state columns of `cards`, 1:1 with the ts-fsrs `Card`. */
export type FsrsCardColumns = Pick<
  CardRow,
  | "due"
  | "stability"
  | "difficulty"
  | "elapsedDays"
  | "scheduledDays"
  | "learningSteps"
  | "reps"
  | "lapses"
  | "state"
  | "lastReview"
>;

/** A `review_logs` row without its own id and card reference. */
export type FsrsReviewLogColumns = Omit<ReviewLogRow, "id" | "cardId">;

function toState(value: number): State {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new Error(`invalid FSRS state ${value}`);
  }
  return value as State;
}

function toRating(value: number): Rating {
  if (!Number.isInteger(value) || value < 0 || value > 4) {
    throw new Error(`invalid FSRS rating ${value}`);
  }
  return value as Rating;
}

export function fsrsCardToColumns(card: Card): FsrsCardColumns {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ?? null,
  };
}

export function columnsToFsrsCard(row: FsrsCardColumns): Card {
  const card: Card = {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: toState(row.state),
  };
  if (row.lastReview) card.last_review = row.lastReview;
  return card;
}

export function fsrsReviewLogToColumns(log: ReviewLog): FsrsReviewLogColumns {
  return {
    rating: log.rating,
    state: log.state,
    due: log.due,
    stability: log.stability,
    difficulty: log.difficulty,
    elapsedDays: log.elapsed_days,
    lastElapsedDays: log.last_elapsed_days,
    scheduledDays: log.scheduled_days,
    learningSteps: log.learning_steps,
    reviewedAt: log.review,
  };
}

export function columnsToFsrsReviewLog(row: FsrsReviewLogColumns): ReviewLog {
  return {
    rating: toRating(row.rating),
    state: toState(row.state),
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    last_elapsed_days: row.lastElapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    review: row.reviewedAt,
  };
}
