import { describe, expect, test } from "bun:test";
import { createEmptyCard, default_w, Rating } from "ts-fsrs";
import { DEFAULT_PROFILE, RETENTION_OPTIONS, schedulerFrom } from "../../src/fsrs/scheduler";
import {
  applyItem,
  CHECK_ITEMS,
  EMPTY_PROGRESS,
  placeMastered,
  TOPIC_SCHEDULER,
} from "../../src/grammar/mastery";
import { Scheduler } from "../../src/vocab/scheduler";

const DAY = 86_400_000;
const start = new Date("2026-10-01T09:00:00Z");

/** Days to the next review after a Good on a new card and then Good on the day it is due. */
function secondInterval(retention: number, weights: readonly number[] | null = null): number {
  const scheduler = schedulerFrom({ retention, weights }, { shortTerm: false });
  const first = scheduler.next(createEmptyCard(start), start, Rating.Good).card;
  const second = scheduler.next(first, first.due, Rating.Good).card;
  return second.scheduled_days;
}

describe("desired retention", () => {
  test("a lower target gives longer intervals, a higher one shorter", () => {
    const intervals = RETENTION_OPTIONS.map((percent) => secondInterval(percent));
    expect(intervals).toEqual([...intervals].sort((a, b) => b - a));
    expect(intervals[0]).toBeGreaterThan(intervals.at(-1) ?? Infinity);
  });

  test("the default profile is today's scheduler: 90% and the ts-fsrs defaults", () => {
    expect(DEFAULT_PROFILE).toEqual({ retention: 90, weights: null });
    expect(schedulerFrom(DEFAULT_PROFILE, { shortTerm: true }).parameters.request_retention).toBe(
      0.9,
    );
  });

  test("a value outside 85..95 is clamped into it", () => {
    expect(secondInterval(50)).toBe(secondInterval(85));
    expect(secondInterval(99)).toBe(secondInterval(95));
  });

  test("fitted weights change the intervals", () => {
    const slower = default_w.map((w, i) => (i < 4 ? w * 3 : w));
    expect(secondInterval(90, slower)).not.toBe(secondInterval(90));
  });

  test("words rate with the learner's scheduler", () => {
    const words = new Scheduler();
    const card = words.newCard(start);
    const at85 = schedulerFrom({ retention: 85, weights: null }, { shortTerm: true });
    const at95 = schedulerFrom({ retention: 95, weights: null }, { shortTerm: true });
    const learnt85 = words.rate(card, "easy", start, at85).next;
    const learnt95 = words.rate(card, "easy", start, at95).next;
    const later = new Date(start.getTime() + 20 * DAY);
    expect(words.rate(learnt85, "good", later, at85).next.scheduledDays).toBeGreaterThan(
      words.rate(learnt95, "good", later, at95).next.scheduledDays,
    );
  });

  test("grammar topics are scheduled with the scheduler they are given", () => {
    // Placed as mastered, then its first check passed on the day it is due: the interval the
    // check sets depends on the target.
    const intervalAfterCheck = (percent: number) => {
      const scheduler = schedulerFrom({ retention: percent, weights: null }, TOPIC_SCHEDULER);
      let progress = placeMastered(EMPTY_PROGRESS, start, scheduler);
      const due = progress.reviewDue ?? start;
      for (let i = 0; i < CHECK_ITEMS; i++) {
        const item = { type: "mcq", score: 1, session: 1 };
        progress = applyItem(progress, item, due, scheduler).progress;
      }
      expect(progress.status).toBe("mastered");
      return (progress.reviewDue?.getTime() ?? 0) - due.getTime();
    };
    expect(intervalAfterCheck(85)).toBeGreaterThan(intervalAfterCheck(95));
  });
});
