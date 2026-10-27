import { describe, expect, test } from "bun:test";
import {
  accuracyByType,
  applyItem,
  applyTransfer,
  CHECK_ITEMS,
  CONFIRMATION_MS,
  EMPTY_PROGRESS,
  isDue,
  MASTERY_WINDOW,
  masteryRule,
  type TopicProgress,
  windowHolds,
} from "../../src/grammar/mastery";

const T0 = new Date("2026-10-01T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number, minutes = 0) => new Date(T0.getTime() + days * DAY + minutes * 60_000);
const TYPES = ["multiple_choice", "gap_fill"] as const;

/** `n` items in a row, alternating two types, one minute apart from `start`. */
function feed(progress: TopicProgress, n: number, score: number, start: Date) {
  let current = progress;
  const steps = [];
  for (let i = 0; i < n; i++) {
    const step = applyItem(
      current,
      { type: TYPES[i % 2] ?? "gap_fill", score },
      new Date(start.getTime() + i * 60_000),
    );
    steps.push(step);
    current = step.progress;
  }
  return { progress: current, steps, last: steps.at(-1) };
}

/** A topic mastered at day 3: a full right window on day 0, one transfer, a right item on day 3. */
function mastered(): TopicProgress {
  const day0 = feed(EMPTY_PROGRESS, MASTERY_WINDOW, 1, at(0)).progress;
  const used = applyTransfer(day0, 1, at(1)).progress;
  const step = applyItem(used, { type: "gap_fill", score: 1 }, at(3, 30));
  expect(step.progress.status).toBe("mastered");
  return step.progress;
}

describe("the rolling window", () => {
  test("keeps the last items only and derives accuracy per type", () => {
    const { progress } = feed(EMPTY_PROGRESS, MASTERY_WINDOW + 3, 1, at(0));
    expect(progress.recentItems).toHaveLength(MASTERY_WINDOW);
    expect(
      accuracyByType([
        { type: "gap_fill", score: 1, at: "" },
        { type: "gap_fill", score: 0, at: "" },
        { type: "multiple_choice", score: 0.5, at: "" },
      ]),
    ).toEqual({ gap_fill: 0.5, multiple_choice: 0.5 });
    expect(progress.accuracyByType).toEqual({ multiple_choice: 1, gap_fill: 1 });
  });

  test("holds only when full, at least 85 % and across two types", () => {
    const items = (n: number, score: number, types: string[]) =>
      Array.from({ length: n }, (_, i) => ({ type: types[i % types.length] ?? "", score, at: "" }));
    expect(windowHolds(items(MASTERY_WINDOW, 1, ["a", "b"]))).toBe(true);
    expect(windowHolds(items(MASTERY_WINDOW - 1, 1, ["a", "b"]))).toBe(false);
    expect(windowHolds(items(MASTERY_WINDOW, 1, ["a"]))).toBe(false);
    const mixed = [...items(MASTERY_WINDOW - 2, 1, ["a", "b"]), ...items(2, 0.5, ["a"])];
    expect(windowHolds(mixed)).toBe(true); // 7/8 = 0.875
    const low = [...items(MASTERY_WINDOW - 2, 1, ["a", "b"]), ...items(2, 0, ["a"])];
    expect(windowHolds(low)).toBe(false); // 6/8 = 0.75
  });
});

describe("not_started → learning", () => {
  test("the first graded item starts the topic, right or wrong", () => {
    expect(applyItem(EMPTY_PROGRESS, { type: "gap_fill", score: 0 }, at(0)).progress.status).toBe(
      "learning",
    );
    const step = applyItem(EMPTY_PROGRESS, { type: "gap_fill", score: 1 }, at(0));
    expect(step).toMatchObject({ from: "not_started", mastered: false });
    expect(step.progress.status).toBe("learning");
  });

  test("transfer evidence alone does not start or master a topic", () => {
    const step = applyTransfer(EMPTY_PROGRESS, 3, at(0));
    expect(step.progress).toMatchObject({ status: "not_started", transferEvidence: 3 });
    expect(step.mastered).toBe(false);
  });
});

describe("learning → mastered", () => {
  test("a perfect day is not enough: the confirmation and a transfer are still missing", () => {
    const { progress } = feed(EMPTY_PROGRESS, MASTERY_WINDOW * 2, 1, at(0));
    expect(progress.status).toBe("learning");
    expect(progress.criteriaMetAt).toEqual(at(0, MASTERY_WINDOW - 1));
    expect(progress.confirmedAt).toBeNull();
    expect(masteryRule(progress)).toBe(false);
  });

  test("an item under three days after the rule first held does not confirm it", () => {
    const day0 = feed(EMPTY_PROGRESS, MASTERY_WINDOW, 1, at(0)).progress;
    const used = applyTransfer(day0, 1, at(1)).progress;
    const early = applyItem(used, { type: "gap_fill", score: 1 }, at(2));
    expect(early.progress.status).toBe("learning");
    expect(early.progress.confirmedAt).toBeNull();
  });

  test("confirmed ≥3 days later with a transfer: mastered, first time, and into FSRS", () => {
    const day0 = feed(EMPTY_PROGRESS, MASTERY_WINDOW, 1, at(0)).progress;
    const used = applyTransfer(day0, 1, at(1)).progress;
    const when = at(3, 10);
    expect(when.getTime() - (day0.criteriaMetAt?.getTime() ?? 0)).toBeGreaterThanOrEqual(
      CONFIRMATION_MS,
    );
    const step = applyItem(used, { type: "gap_fill", score: 1 }, when);
    expect(step).toMatchObject({ from: "learning", mastered: true, firstMastery: true });
    expect(step.progress).toMatchObject({ status: "mastered", masteredAt: at(3, 10) });
    expect(step.progress.firstMasteredAt).toEqual(at(3, 10));
    expect(step.progress.fsrs).not.toBeNull();
    expect(step.progress.reviewDue?.getTime()).toBeGreaterThan(at(3, 10).getTime() + DAY / 2);
  });

  test("confirmed without a transfer waits; the transfer then masters it", () => {
    const day0 = feed(EMPTY_PROGRESS, MASTERY_WINDOW, 1, at(0)).progress;
    const confirmed = applyItem(day0, { type: "gap_fill", score: 1 }, at(4));
    expect(confirmed.progress.status).toBe("learning");
    expect(confirmed.progress.confirmedAt).toEqual(at(4));
    const step = applyTransfer(confirmed.progress, 1, at(5));
    expect(step).toMatchObject({ mastered: true, firstMastery: true });
    expect(step.progress.status).toBe("mastered");
  });

  test("a window that breaks before the confirmation resets the clock", () => {
    const day0 = feed(EMPTY_PROGRESS, MASTERY_WINDOW, 1, at(0)).progress;
    const broken = feed(day0, 2, 0, at(1)).progress;
    expect(broken.criteriaMetAt).toBeNull();
    const used = applyTransfer(broken, 1, at(1)).progress;
    // Back above the threshold on day 3: the clock restarts there, so day 3 does not confirm.
    const again = feed(used, MASTERY_WINDOW, 1, at(3)).progress;
    expect(again.status).toBe("learning");
    expect(again.criteriaMetAt?.getTime()).toBeGreaterThanOrEqual(at(3).getTime());
  });

  test("a window of one exercise type never masters", () => {
    let progress = applyTransfer(EMPTY_PROGRESS, 1, at(0)).progress;
    for (const day of [0, 4]) {
      for (let i = 0; i < MASTERY_WINDOW; i++) {
        progress = applyItem(progress, { type: "gap_fill", score: 1 }, at(day, i)).progress;
      }
    }
    expect(progress.status).toBe("learning");
  });
});

describe("mastered → shaky → mastered", () => {
  test("falling below the threshold makes it shaky and the confirmation is owed again", () => {
    const start = mastered();
    // Not due yet: day 3 + a few minutes.
    const { progress, steps } = feed(start, 2, 0, at(3, 35));
    expect(steps[0]?.progress.status).toBe("mastered"); // 7/8 still ≥ 85 %
    expect(progress.status).toBe("shaky");
    expect(progress).toMatchObject({ criteriaMetAt: null, confirmedAt: null, masteredAt: null });
    expect(progress.firstMasteredAt).not.toBeNull();
  });

  test("a shaky topic is mastered again on the rule, not for the first time", () => {
    const shaky = feed(mastered(), 2, 0, at(3, 35)).progress;
    const back = feed(shaky, MASTERY_WINDOW, 1, at(4)).progress;
    expect(back.status).toBe("shaky");
    const step = applyItem(back, { type: "gap_fill", score: 1 }, at(8));
    expect(step).toMatchObject({ from: "shaky", mastered: true, firstMastery: false });
    expect(step.progress.status).toBe("mastered");
  });
});

describe("a due mastered topic is checked", () => {
  const due = () => {
    const progress = mastered();
    const when = new Date((progress.reviewDue?.getTime() ?? 0) + 60_000);
    expect(isDue(progress, when)).toBe(true);
    return { progress, when };
  };

  test("not due before its FSRS date", () => {
    const progress = mastered();
    expect(isDue(progress, at(3, 40))).toBe(false);
    expect(isDue(EMPTY_PROGRESS, at(100))).toBe(false);
  });

  test(`${CHECK_ITEMS} right items pass it and reschedule it later`, () => {
    const { progress, when } = due();
    const { progress: after, steps } = feed(progress, CHECK_ITEMS, 1, when);
    expect(steps.slice(0, -1).every((s) => s.checked === undefined)).toBe(true);
    expect(steps.at(-1)?.checked).toBe("passed");
    expect(after.status).toBe("mastered");
    expect(after.checkScores).toEqual([]);
    expect(after.reviewDue?.getTime()).toBeGreaterThan(progress.reviewDue?.getTime() ?? 0);
    expect(after.fsrs?.reps).toBe((progress.fsrs?.reps ?? 0) + 1);
  });

  test("a wrong check item sends it back to learning at once", () => {
    const { progress, when } = due();
    const right = applyItem(progress, { type: "gap_fill", score: 1 }, when).progress;
    expect(right.checkScores).toEqual([1]);
    const step = applyItem(
      right,
      { type: "gap_fill", score: 0 },
      new Date(when.getTime() + 60_000),
    );
    expect(step.checked).toBe("failed");
    expect(step.progress).toMatchObject({ status: "learning", checkScores: [], masteredAt: null });
    expect(step.progress.fsrs?.lapses).toBe((progress.fsrs?.lapses ?? 0) + 1);
  });

  test("partial credit passes the check, rated Hard — sooner than Good", () => {
    const { progress, when } = due();
    const partial = feed(progress, CHECK_ITEMS, 0.5, when);
    const right = feed(progress, CHECK_ITEMS, 1, when);
    expect(partial.last?.checked).toBe("passed");
    expect(partial.progress.reviewDue?.getTime()).toBeLessThan(
      right.progress.reviewDue?.getTime() ?? 0,
    );
    // Three halves take the window to 6.5/8 < 85 %: passed, but shaky.
    expect(partial.progress.status).toBe("shaky");
  });

  test("a failed check topic is mastered again later, not for the first time", () => {
    const { progress, when } = due();
    const failed = applyItem(progress, { type: "gap_fill", score: 0 }, when).progress;
    const back = feed(failed, MASTERY_WINDOW, 1, new Date(when.getTime() + DAY)).progress;
    const step = applyItem(
      back,
      { type: "gap_fill", score: 1 },
      new Date(when.getTime() + 5 * DAY),
    );
    expect(step).toMatchObject({ from: "learning", mastered: true, firstMastery: false });
  });
});
