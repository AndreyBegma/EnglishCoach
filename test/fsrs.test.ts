import { describe, expect, test } from "bun:test";
import { createEmptyCard } from "ts-fsrs";
import { columnsToFsrsCard, columnsToFsrsReviewLog, fsrsCardToColumns } from "../src/db/fsrs";

describe("FSRS column mappers", () => {
  test("map every ts-fsrs Card field and back", () => {
    const card = createEmptyCard(new Date("2026-10-01T08:30:00Z"));
    expect(columnsToFsrsCard(fsrsCardToColumns(card))).toEqual(card);
  });

  test("a stored null last_review becomes an absent field", () => {
    const columns = fsrsCardToColumns(createEmptyCard(new Date("2026-10-01T08:30:00Z")));
    expect(columns.lastReview).toBeNull();
    expect("last_review" in columnsToFsrsCard(columns)).toBe(false);
  });

  test("reject a state outside the ts-fsrs enum", () => {
    const columns = fsrsCardToColumns(createEmptyCard(new Date("2026-10-01T08:30:00Z")));
    expect(() => columnsToFsrsCard({ ...columns, state: 7 })).toThrow("invalid FSRS state 7");
  });

  test("reject a rating outside the ts-fsrs enum", () => {
    const now = new Date("2026-10-01T08:30:00Z");
    expect(() =>
      columnsToFsrsReviewLog({
        rating: 9,
        state: 0,
        due: now,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        lastElapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reviewedAt: now,
      }),
    ).toThrow("invalid FSRS rating 9");
  });
});
