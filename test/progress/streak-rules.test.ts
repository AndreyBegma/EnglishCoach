import { describe, expect, test } from "bun:test";
import {
  addDays,
  currentStreak,
  doubleGoalMet,
  MAX_FREEZES,
  milestonesCrossed,
  type Run,
  restoreOffer,
  settleDays,
  weekStart,
} from "../../src/progress/streak-rules";
import { localDate } from "../../src/routine/time";

const goals = (...days: string[]) => new Set(days);

describe("calendar days", () => {
  test("addDays crosses months, years and leap days", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("addDays is a calendar day on DST days, whatever the zone", () => {
    // Kyiv springs forward on 2026-03-29 and falls back on 2026-10-25.
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  test("weeks start on Monday", () => {
    expect(weekStart("2026-03-16")).toBe("2026-03-16"); // Monday
    expect(weekStart("2026-03-22")).toBe("2026-03-16"); // Sunday
    expect(weekStart("2026-03-15")).toBe("2026-03-09");
  });
});

describe("settleDays", () => {
  test("a missed day of a live run spends a freeze and keeps the run", () => {
    const outcome = settleDays(
      { freezes: 1, grantedWeek: "2026-03-16" },
      {
        from: "2026-03-17",
        through: "2026-03-19",
        run: 3,
        goalDays: goals("2026-03-17", "2026-03-19"),
      },
    );
    expect(outcome).toEqual({ freezes: 0, grantedWeek: "2026-03-16", frozen: ["2026-03-18"] });
  });

  test("without a freeze the run breaks, and a broken run spends nothing more", () => {
    const outcome = settleDays(
      { freezes: 0, grantedWeek: "2026-03-16" },
      { from: "2026-03-17", through: "2026-03-18", run: 3, goalDays: goals() },
    );
    expect(outcome.frozen).toEqual([]);
    // Two missed days, one freeze: the first is frozen, the second breaks; the next week's free
    // freeze is not burnt on the dead run.
    const later = settleDays(
      { freezes: 1, grantedWeek: "2026-03-16" },
      { from: "2026-03-21", through: "2026-03-24", run: 2, goalDays: goals() },
    );
    expect(later).toEqual({ freezes: 1, grantedWeek: "2026-03-23", frozen: ["2026-03-21"] });
  });

  test("no run, no freeze spent", () => {
    const outcome = settleDays(
      { freezes: 2, grantedWeek: "2026-03-16" },
      { from: "2026-03-17", through: "2026-03-18", run: 0, goalDays: goals() },
    );
    expect(outcome).toEqual({ freezes: 2, grantedWeek: "2026-03-16", frozen: [] });
  });

  test("one free freeze each new week, never above the cap", () => {
    const outcome = settleDays(
      { freezes: 0, grantedWeek: null },
      {
        from: "2026-03-01",
        through: "2026-03-31",
        run: 0,
        goalDays: goals(...Array.from({ length: 31 }, (_, i) => addDays("2026-03-01", i))),
      },
    );
    expect(outcome.freezes).toBe(MAX_FREEZES);
    expect(outcome.grantedWeek).toBe("2026-03-30");
    expect(outcome.frozen).toEqual([]);
  });

  test("a freeze granted on Monday covers that Monday", () => {
    const outcome = settleDays(
      { freezes: 0, grantedWeek: "2026-03-09" },
      { from: "2026-03-15", through: "2026-03-16", run: 4, goalDays: goals("2026-03-15") },
    );
    expect(outcome).toEqual({ freezes: 0, grantedWeek: "2026-03-16", frozen: ["2026-03-16"] });
  });

  test("settling the same window twice is the caller's to avoid: an empty window changes nothing", () => {
    const state = { freezes: 1, grantedWeek: "2026-03-16" };
    expect(
      settleDays(state, { from: "2026-03-20", through: "2026-03-19", run: 5, goalDays: goals() }),
    ).toEqual({ ...state, frozen: [] });
  });
});

describe("currentStreak and restoreOffer", () => {
  const run = (firstDay: string, lastDay: string, days: number): Run => ({
    firstDay,
    lastDay,
    days,
  });

  test("the run ending today or yesterday is current", () => {
    expect(currentStreak([run("2026-03-12", "2026-03-15", 4)], "2026-03-16")).toBe(4);
    expect(currentStreak([run("2026-03-12", "2026-03-16", 5)], "2026-03-16")).toBe(5);
    expect(currentStreak([run("2026-03-12", "2026-03-14", 3)], "2026-03-16")).toBe(0);
  });

  test("a frozen day bridges the run without counting", () => {
    // 12-16 with the 14th frozen: five kept days, four counted.
    expect(currentStreak([run("2026-03-12", "2026-03-16", 4)], "2026-03-17")).toBe(4);
  });

  test("offered the whole day after a break, not later and not without a run", () => {
    const runs = [run("2026-03-12", "2026-03-15", 4)];
    expect(restoreOffer(runs, "2026-03-17")).toEqual({ missed: "2026-03-16", days: 4 });
    expect(restoreOffer(runs, "2026-03-18")).toBeUndefined();
    expect(restoreOffer(runs, "2026-03-16")).toBeUndefined();
    expect(restoreOffer([], "2026-03-17")).toBeUndefined();
  });

  test("today's goal does not hide the offer; a kept yesterday does", () => {
    const today = run("2026-03-17", "2026-03-17", 1);
    expect(restoreOffer([today, run("2026-03-12", "2026-03-15", 4)], "2026-03-17")).toEqual({
      missed: "2026-03-16",
      days: 4,
    });
    expect(restoreOffer([run("2026-03-12", "2026-03-16", 4)], "2026-03-17")).toBeUndefined();
  });

  test("the window is the learner-local day, 23 hours long across spring-forward", () => {
    // Kyiv, 2026-03-29 is 23 h long (03:00 → 04:00). The 28th was missed after a 4-day run.
    const runs = [run("2026-03-24", "2026-03-27", 4)];
    const offerAt = (iso: string) => restoreOffer(runs, localDate(new Date(iso), "Europe/Kyiv"));
    expect(offerAt("2026-03-28T22:00:00Z")).toEqual({ missed: "2026-03-28", days: 4 }); // 00:00 EET
    expect(offerAt("2026-03-29T20:59:00Z")).toEqual({ missed: "2026-03-28", days: 4 }); // 23:59 EEST
    expect(offerAt("2026-03-29T21:00:00Z")).toBeUndefined(); // 00:00 on the 30th
  });

  test("and 25 hours long across fall-back", () => {
    // Kyiv, 2026-10-25 is 25 h long (04:00 → 03:00). The 24th was missed.
    const runs = [run("2026-10-20", "2026-10-23", 4)];
    const offerAt = (iso: string) => restoreOffer(runs, localDate(new Date(iso), "Europe/Kyiv"));
    expect(offerAt("2026-10-24T21:00:00Z")).toEqual({ missed: "2026-10-24", days: 4 }); // 00:00 EEST
    expect(offerAt("2026-10-25T21:59:00Z")).toEqual({ missed: "2026-10-24", days: 4 }); // 23:59 EET
    expect(offerAt("2026-10-25T22:00:00Z")).toBeUndefined();
  });
});

describe("doubleGoalMet", () => {
  test("twice the new words and at least two reviews or grammar answers", () => {
    expect(doubleGoalMet({ newWords: 10, reviews: 1, grammarAnswered: 1 }, 5)).toBe(true);
    expect(doubleGoalMet({ newWords: 10, reviews: 0, grammarAnswered: 2 }, 5)).toBe(true);
    expect(doubleGoalMet({ newWords: 9, reviews: 5, grammarAnswered: 5 }, 5)).toBe(false);
    expect(doubleGoalMet({ newWords: 10, reviews: 1, grammarAnswered: 0 }, 5)).toBe(false);
    expect(doubleGoalMet(undefined, 5)).toBe(false);
  });
});

describe("milestonesCrossed", () => {
  test("each milestone once, on the step that reaches it", () => {
    expect(milestonesCrossed(6, 7)).toEqual([{ days: 7, xp: 50 }]);
    expect(milestonesCrossed(7, 8)).toEqual([]);
    expect(milestonesCrossed(29, 30)).toEqual([{ days: 30, xp: 150 }]);
    expect(milestonesCrossed(99, 100)).toEqual([{ days: 100, xp: 500 }]);
    expect(milestonesCrossed(364, 365)).toEqual([{ days: 365, xp: 1500 }]);
  });

  test("a restore that jumps pays every milestone it passes", () => {
    expect(milestonesCrossed(1, 32)).toEqual([
      { days: 7, xp: 50 },
      { days: 30, xp: 150 },
    ]);
  });
});
