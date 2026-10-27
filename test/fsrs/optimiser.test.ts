import { describe, expect, test } from "bun:test";
import type { LoggedReview } from "../../src/db/repositories/fsrs";
import { bindingFitter, trainingItems } from "../../src/fsrs/optimiser";
import { syntheticLog } from "./synthetic-log";

const at = (iso: string) => new Date(iso);

const deltas = (items: ReturnType<typeof trainingItems>["items"]) =>
  items.map((item) => item.reviews.map((review) => [review.rating, review.deltaT]));

describe("trainingItems", () => {
  test("days between reviews on the learner's calendar, one item per review after the first", () => {
    const reviews: LoggedReview[] = [
      { cardId: 1, rating: 3, state: 0, reviewedAt: at("2026-10-01T20:00:00Z") },
      // 23:30 in Kyiv on 2026-10-02 (UTC+3): one day later there, though it is still the 2nd in UTC.
      { cardId: 1, rating: 1, state: 2, reviewedAt: at("2026-10-02T20:30:00Z") },
      { cardId: 1, rating: 3, state: 3, reviewedAt: at("2026-10-02T21:10:00Z") },
      { cardId: 1, rating: 4, state: 2, reviewedAt: at("2026-10-06T08:00:00Z") },
    ];
    expect(deltas(trainingItems(reviews, "Europe/Kyiv").items)).toEqual([
      [
        [3, 0],
        [1, 1],
      ],
      [
        [3, 0],
        [1, 1],
        [3, 1],
      ],
      [
        [3, 0],
        [1, 1],
        [3, 1],
        [4, 3],
      ],
    ]);
    // In UTC the third review is on the same day as the second.
    expect(deltas(trainingItems(reviews, "UTC").items)[1]).toEqual([
      [3, 0],
      [1, 1],
      [3, 0],
    ]);
  });

  test("manual reschedules are not recalls, and history before a card's first review is dropped", () => {
    const reviews: LoggedReview[] = [
      { cardId: 2, rating: 3, state: 2, reviewedAt: at("2026-09-01T09:00:00Z") },
      { cardId: 2, rating: 3, state: 0, reviewedAt: at("2026-10-01T09:00:00Z") },
      { cardId: 2, rating: 0, state: 2, reviewedAt: at("2026-10-02T09:00:00Z") },
      { cardId: 2, rating: 2, state: 2, reviewedAt: at("2026-10-04T09:00:00Z") },
      // A card with no first review in the log at all: nothing to learn from.
      { cardId: 3, rating: 3, state: 2, reviewedAt: at("2026-10-04T09:00:00Z") },
    ];
    const { items, reviewCount } = trainingItems(reviews, "UTC");
    expect(deltas(items)).toEqual([
      [
        [3, 0],
        [2, 3],
      ],
    ]);
    expect(reviewCount).toBe(2);
  });
});

describe("the FSRS optimiser binding under Bun", () => {
  test("fits 21 FSRS-6 weights that beat the defaults on a synthetic log", async () => {
    const reviews = syntheticLog({
      cards: 200,
      reviewsPerCard: 7,
      start: at("2026-01-01T09:00:00Z"),
    }).flatMap((logs, cardId) =>
      logs.map((log) => ({
        cardId,
        rating: log.rating,
        state: log.state,
        reviewedAt: log.reviewedAt,
      })),
    );
    const { items } = trainingItems(reviews, "UTC");
    const weights = await bindingFitter.fit(items);
    expect(weights).toHaveLength(21);
    expect(weights.every(Number.isFinite)).toBe(true);
    expect(bindingFitter.logLoss(weights, items)).toBeLessThan(bindingFitter.logLoss(null, items));
  });
});
