import { describe, expect, test } from "bun:test";
import { State } from "ts-fsrs";
import { modeFor } from "../../src/vocab/modes";
import { Scheduler } from "../../src/vocab/scheduler";
import { localDate } from "../../src/vocab/stats";

const at = (iso: string) => new Date(iso);
const DAY = 86_400_000;

describe("Scheduler (ts-fsrs, fixed dates)", () => {
  const scheduler = new Scheduler();

  test("a new card rated Good moves its due date forward and leaves New", () => {
    const now = at("2026-10-26T08:30:00Z");
    const card = scheduler.newCard(now);
    expect(card).toMatchObject({ state: State.New, reps: 0, lapses: 0, lastReview: null });

    const { next, log } = scheduler.rate(card, "good", now);
    expect(next.due.getTime()).toBeGreaterThan(now.getTime());
    expect(next.state).not.toBe(State.New);
    expect(next.reps).toBe(1);
    expect(next.lastReview).toEqual(now);
    // The log records the state the card was in before this review.
    expect(log).toMatchObject({ rating: 3, state: State.New, reviewedAt: now });
  });

  test("Good again a day later schedules further out than the first Good", () => {
    const first = at("2026-10-26T08:30:00Z");
    const once = scheduler.rate(scheduler.newCard(first), "good", first).next;
    const second = at("2026-10-27T08:30:00Z");
    const twice = scheduler.rate(once, "good", second).next;
    expect(twice.due.getTime() - second.getTime()).toBeGreaterThan(
      once.due.getTime() - first.getTime(),
    );
  });

  test("Again on a card in Review is a lapse: lapses +1, Relearning, due within a day", () => {
    let card = scheduler.newCard(at("2026-10-01T08:00:00Z"));
    let now = at("2026-10-01T08:00:00Z");
    // Good until the card graduates to Review.
    while (card.state !== State.Review) {
      card = scheduler.rate(card, "good", now).next;
      now = card.due;
    }
    expect(card.lapses).toBe(0);

    const reviewAt = card.due;
    const { next, log } = scheduler.rate(card, "again", reviewAt);
    expect(next.lapses).toBe(1);
    expect(next.state).toBe(State.Relearning);
    expect(next.due.getTime() - reviewAt.getTime()).toBeLessThan(DAY);
    expect(log).toMatchObject({ rating: 1, state: State.Review });
  });

  test("the same input gives the same schedule (no fuzz)", () => {
    const now = at("2026-10-26T08:30:00Z");
    const card = scheduler.newCard(now);
    expect(scheduler.rate(card, "easy", now)).toEqual(scheduler.rate(card, "easy", now));
  });
});

describe("modeFor", () => {
  test("rotates recognition → production → cloze as stability grows", () => {
    expect(modeFor({ reps: 0, stability: 50 })).toBe("recognition");
    expect(modeFor({ reps: 3, stability: 1.2 })).toBe("recognition");
    expect(modeFor({ reps: 3, stability: 3 })).toBe("production");
    expect(modeFor({ reps: 5, stability: 9.9 })).toBe("production");
    expect(modeFor({ reps: 6, stability: 10 })).toBe("cloze");
  });
});

describe("localDate", () => {
  test("is the learner's calendar date, not UTC's", () => {
    const now = at("2026-10-26T22:30:00Z");
    expect(localDate(now, "UTC")).toBe("2026-10-26");
    expect(localDate(now, "Europe/Kyiv")).toBe("2026-10-27");
    expect(localDate(now, "America/New_York")).toBe("2026-10-26");
  });
});
