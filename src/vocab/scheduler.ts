import { createEmptyCard, type FSRS, fsrs, Rating } from "ts-fsrs";
import {
  columnsToFsrsCard,
  type FsrsCardColumns,
  type FsrsReviewLogColumns,
  fsrsCardToColumns,
  fsrsReviewLogToColumns,
} from "../db/fsrs";

export const RATINGS = ["again", "hard", "good", "easy"] as const;
export type RatingName = (typeof RATINGS)[number];

const RATING: Record<RatingName, Rating.Again | Rating.Hard | Rating.Good | Rating.Easy> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export interface Scheduled {
  next: FsrsCardColumns;
  log: FsrsReviewLogColumns;
}

/** FSRS on the server: the only place a card's schedule changes. Default parameters, no fuzz. */
export class Scheduler {
  private readonly fsrs: FSRS = fsrs();

  /** The FSRS state of a card that was never reviewed. */
  newCard(now: Date): FsrsCardColumns {
    return fsrsCardToColumns(createEmptyCard(now));
  }

  rate(card: FsrsCardColumns, rating: RatingName, now: Date): Scheduled {
    const result = this.fsrs.next(columnsToFsrsCard(card), now, RATING[rating]);
    return { next: fsrsCardToColumns(result.card), log: fsrsReviewLogToColumns(result.log) };
  }
}
