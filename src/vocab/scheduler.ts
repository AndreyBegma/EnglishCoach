import { createEmptyCard, type FSRS, Rating } from "ts-fsrs";
import {
  columnsToFsrsCard,
  type FsrsCardColumns,
  type FsrsReviewLogColumns,
  fsrsCardToColumns,
  fsrsReviewLogToColumns,
} from "../db/fsrs";
import { DEFAULT_PROFILE, schedulerFrom } from "../fsrs/scheduler";

export const RATINGS = ["again", "hard", "good", "easy"] as const;
export type RatingName = (typeof RATINGS)[number];

const RATING: Record<RatingName, Rating.Again | Rating.Hard | Rating.Good | Rating.Easy> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** A learner with default settings: default parameters, 90% retention, short-term steps. */
const defaultScheduler = schedulerFrom(DEFAULT_PROFILE, { shortTerm: true });

export interface Scheduled {
  next: FsrsCardColumns;
  log: FsrsReviewLogColumns;
}

/**
 * FSRS on the server: the only place a card's schedule changes. Rated with the learner's scheduler
 * (`fsrsFor`: their desired retention and fitted parameters, no fuzz).
 */
export class Scheduler {
  /** The FSRS state of a card that was never reviewed. */
  newCard(now: Date): FsrsCardColumns {
    return fsrsCardToColumns(createEmptyCard(now));
  }

  rate(
    card: FsrsCardColumns,
    rating: RatingName,
    now: Date,
    fsrs: FSRS = defaultScheduler,
  ): Scheduled {
    const result = fsrs.next(columnsToFsrsCard(card), now, RATING[rating]);
    return { next: fsrsCardToColumns(result.card), log: fsrsReviewLogToColumns(result.log) };
  }
}
