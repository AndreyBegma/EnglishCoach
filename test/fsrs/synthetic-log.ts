import { type Card, createEmptyCard, default_w, fsrs, Rating } from "ts-fsrs";
import { type FsrsReviewLogColumns, fsrsReviewLogToColumns } from "../../src/db/fsrs";

/** A seeded generator, so a synthetic log is the same on every run. */
export function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/** A learner whose memory is not the default model: they forget faster than it predicts. */
const TRUE_WEIGHTS = default_w.map((w, i) => (i < 4 ? w * 0.35 : w));

/**
 * A synthetic review log: `cards` cards, each first seen at `start` and then reviewed when the
 * default scheduler says, `reviewsPerCard` times. Each answer is drawn from the learner's true
 * recall probability at that moment, so a fit has something real to find.
 */
export function syntheticLog(options: {
  cards: number;
  reviewsPerCard: number;
  start: Date;
  seed?: number;
}): FsrsReviewLogColumns[][] {
  const random = seeded(options.seed ?? 7);
  const scheduler = fsrs({ enable_short_term: false });
  const truth = fsrs({ enable_short_term: false, w: [...TRUE_WEIGHTS] });
  const logs: FsrsReviewLogColumns[][] = [];
  for (let c = 0; c < options.cards; c++) {
    const startAt = new Date(options.start.getTime() + c * 60_000);
    let card: Card = createEmptyCard(startAt);
    let truthCard: Card = createEmptyCard(startAt);
    let at = startAt;
    const cardLogs: FsrsReviewLogColumns[] = [];
    for (let r = 0; r < options.reviewsPerCard; r++) {
      const recall = r === 0 ? 1 : truth.get_retrievability(truthCard, at, false);
      const rating =
        random() >= recall ? Rating.Again : random() < 0.15 ? Rating.Hard : Rating.Good;
      const next = scheduler.next(card, at, rating);
      truthCard = truth.next(truthCard, at, rating).card;
      cardLogs.push(fsrsReviewLogToColumns(next.log));
      card = next.card;
      // Reviewed on the due day, at a time of day that varies.
      at = new Date(card.due.getTime() + Math.floor(random() * 8) * 3_600_000);
    }
    logs.push(cardLogs);
  }
  return logs;
}
