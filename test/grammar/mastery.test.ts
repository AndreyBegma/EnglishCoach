import { describe, expect, test } from "bun:test";
import type { TopicSession } from "../../src/db/schema";
import {
  accuracyByType,
  applyItem,
  applyTransfer,
  CHECK_ITEMS,
  EMPTY_PROGRESS,
  ERROR_FREE_MS,
  isDue,
  MASTERY_SESSIONS,
  MASTERY_SPREAD_MS,
  MASTERY_TRANSFER,
  MASTERY_WINDOW,
  masteryRule,
  sessionsHold,
  type TopicProgress,
  transferHolds,
} from "../../src/grammar/mastery";

const T0 = new Date("2026-10-01T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number, minutes = 0) => new Date(T0.getTime() + days * DAY + minutes * 60_000);
const TYPES = ["multiple_choice", "gap_fill"] as const;

/** `n` items of session `session` in a row, alternating two types, one minute apart from `start`. */
function feed(progress: TopicProgress, n: number, score: number, start: Date, session = 1) {
  let current = progress;
  const steps = [];
  for (let i = 0; i < n; i++) {
    const step = applyItem(
      current,
      { type: TYPES[i % 2] ?? "gap_fill", score, session },
      new Date(start.getTime() + i * 60_000),
    );
    steps.push(step);
    current = step.progress;
  }
  return { progress: current, steps, last: steps.at(-1) };
}

/** Three right sessions on days 0, 3 and 7: the practice half of the rule holds, no transfer yet. */
function practised(from: TopicProgress = EMPTY_PROGRESS): TopicProgress {
  let progress = from;
  for (const [session, day] of [
    [1, 0],
    [2, 3],
    [3, 7],
  ] as const) {
    progress = feed(progress, 4, 1, at(day), session).progress;
  }
  expect(sessionsHold(progress.sessionResults)).toBe(true);
  return progress;
}

/** `n` correct uses in free production, an hour apart from `start`. */
function used(progress: TopicProgress, n: number, start: Date) {
  let current = progress;
  for (let i = 0; i < n; i++) {
    current = applyTransfer(current, "correct", new Date(start.getTime() + i * 3_600_000)).progress;
  }
  return current;
}

/** A topic mastered on day 7: practised, then its second correct use. */
function mastered(): TopicProgress {
  const progress = used(practised(), MASTERY_TRANSFER, at(7, 60));
  expect(progress.status).toBe("mastered");
  return progress;
}

const session = (n: number, day: number, mean: number, types = ["a", "b"]): TopicSession => ({
  session: n,
  at: at(day).toISOString(),
  scoreSum: mean * 20,
  items: 20,
  types,
});

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
});

describe("session results", () => {
  test("items of one session add up in one entry, with every type it used", () => {
    const { progress } = feed(EMPTY_PROGRESS, 3, 0.5, at(0), 7);
    expect(progress.sessionResults).toEqual([
      { session: 7, at: at(0).toISOString(), scoreSum: 1.5, items: 3, types: [...TYPES] },
    ]);
  });

  test(`only the last ${MASTERY_SESSIONS} sessions are kept, oldest first`, () => {
    let progress = EMPTY_PROGRESS;
    for (let s = 1; s <= MASTERY_SESSIONS + 2; s++) {
      progress = feed(progress, 1, 1, at(s), s).progress;
    }
    expect(progress.sessionResults.map((s) => s.session)).toEqual([3, 4, 5]);
  });

  test("scores are clamped to 0..1", () => {
    const step = applyItem(EMPTY_PROGRESS, { type: "gap_fill", score: 7, session: 1 }, at(0));
    expect(step.progress.sessionResults[0]?.scoreSum).toBe(1);
  });
});

describe("sessionsHold: ≥85 % in 3 sessions over ≥7 days across ≥2 types", () => {
  test("holds on three accurate, varied sessions a week apart", () => {
    expect(sessionsHold([session(1, 0, 1), session(2, 3, 0.9), session(3, 7, 0.85)])).toBe(true);
  });

  test("needs three sessions", () => {
    expect(sessionsHold([session(1, 0, 1), session(2, 7, 1)])).toBe(false);
    expect(sessionsHold([])).toBe(false);
  });

  test("every counted session needs 85 %", () => {
    expect(sessionsHold([session(1, 0, 1), session(2, 3, 0.8), session(3, 7, 1)])).toBe(false);
  });

  test("the first and last session must be at least 7 days apart", () => {
    const almost = {
      ...session(3, 7, 1),
      at: new Date(at(0).getTime() + MASTERY_SPREAD_MS - 1).toISOString(),
    };
    expect(sessionsHold([session(1, 0, 1), session(2, 3, 1), almost])).toBe(false);
    const exact = { ...almost, at: new Date(at(0).getTime() + MASTERY_SPREAD_MS).toISOString() };
    expect(sessionsHold([session(1, 0, 1), session(2, 3, 1), exact])).toBe(true);
  });

  test("the sessions together must span two exercise types", () => {
    const one = ["gap_fill"];
    expect(
      sessionsHold([session(1, 0, 1, one), session(2, 3, 1, one), session(3, 7, 1, one)]),
    ).toBe(false);
    expect(
      sessionsHold([session(1, 0, 1, one), session(2, 3, 1, one), session(3, 7, 1, ["x"])]),
    ).toBe(true);
  });

  test("an older weak session no longer counts once three newer ones hold", () => {
    expect(
      sessionsHold([session(0, 0, 0), session(1, 1, 1), session(2, 4, 1), session(3, 8, 1)]),
    ).toBe(true);
  });
});

describe("transferHolds: ≥2 correct uses and no error in the last 14 days", () => {
  const base = { ...EMPTY_PROGRESS, transferEvidence: MASTERY_TRANSFER };

  test("needs two correct uses", () => {
    expect(transferHolds({ ...base, transferEvidence: MASTERY_TRANSFER - 1 }, at(0))).toBe(false);
    expect(transferHolds(base, at(0))).toBe(true);
  });

  test("an error inside the 14-day window blocks it; at 14 days it no longer does", () => {
    const erred = { ...base, lastErrorAt: at(0) };
    expect(transferHolds(erred, new Date(at(0).getTime() + ERROR_FREE_MS - 1))).toBe(false);
    expect(transferHolds(erred, new Date(at(0).getTime() + ERROR_FREE_MS))).toBe(true);
  });

  test("masteryRule needs both halves", () => {
    const practice = practised();
    expect(masteryRule(practice, at(8))).toBe(false);
    expect(masteryRule({ ...practice, transferEvidence: 2 }, at(8))).toBe(true);
    expect(masteryRule({ ...practice, transferEvidence: 2, lastErrorAt: at(1) }, at(8))).toBe(
      false,
    );
    expect(masteryRule({ ...EMPTY_PROGRESS, transferEvidence: 2 }, at(8))).toBe(false);
  });
});

describe("not_started → learning", () => {
  test("the first graded item starts the topic, right or wrong", () => {
    const wrong = applyItem(EMPTY_PROGRESS, { type: "gap_fill", score: 0, session: 1 }, at(0));
    expect(wrong.progress.status).toBe("learning");
    const step = applyItem(EMPTY_PROGRESS, { type: "gap_fill", score: 1, session: 1 }, at(0));
    expect(step).toMatchObject({ from: "not_started", mastered: false });
    expect(step.progress.status).toBe("learning");
  });

  test("transfer evidence alone does not start or master a topic", () => {
    const progress = used(EMPTY_PROGRESS, 3, at(0));
    expect(progress).toMatchObject({ status: "not_started", transferEvidence: 3 });
  });
});

describe("learning → mastered", () => {
  test("practice alone waits for two correct uses; the second masters it, into FSRS", () => {
    const practice = practised();
    expect(practice.status).toBe("learning");
    const once = applyTransfer(practice, "correct", at(7, 60));
    expect(once).toMatchObject({ mastered: false });
    expect(once.progress.status).toBe("learning");
    const twice = applyTransfer(once.progress, "correct", at(7, 120));
    expect(twice).toMatchObject({ from: "learning", mastered: true, firstMastery: true });
    expect(twice.progress).toMatchObject({ status: "mastered", masteredAt: at(7, 120) });
    expect(twice.progress.firstMasteredAt).toEqual(at(7, 120));
    expect(twice.progress.fsrs).not.toBeNull();
    expect(twice.progress.reviewDue?.getTime()).toBeGreaterThan(at(7, 120).getTime() + DAY / 2);
  });

  test("uses first: the item that completes the third session masters it", () => {
    let progress = used(EMPTY_PROGRESS, MASTERY_TRANSFER, at(0));
    progress = feed(progress, 4, 1, at(0), 1).progress;
    progress = feed(progress, 4, 1, at(3), 2).progress;
    expect(progress.status).toBe("learning");
    const step = applyItem(progress, { type: "gap_fill", score: 1, session: 3 }, at(7));
    expect(step).toMatchObject({ mastered: true, firstMastery: true });
  });

  test("sessions under 7 days apart do not master it", () => {
    let progress = used(EMPTY_PROGRESS, MASTERY_TRANSFER, at(0));
    for (const [s, day] of [
      [1, 0],
      [2, 2],
      [3, 6],
    ] as const) {
      progress = feed(progress, 4, 1, at(day), s).progress;
    }
    expect(progress.status).toBe("learning");
  });

  test("one exercise type never masters", () => {
    let progress = used(EMPTY_PROGRESS, MASTERY_TRANSFER, at(0));
    for (const [s, day] of [
      [1, 0],
      [2, 3],
      [3, 7],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        progress = applyItem(
          progress,
          { type: "gap_fill", score: 1, session: s },
          at(day, i),
        ).progress;
      }
    }
    expect(progress.status).toBe("learning");
  });

  test("an error in the last 14 days blocks mastery until the window passes", () => {
    const erred = applyTransfer(EMPTY_PROGRESS, "error", at(5)).progress;
    const practice = used(practised(erred), MASTERY_TRANSFER, at(7, 60));
    expect(practice.status).toBe("learning");
    // A session 14 days after the error: days 3, 7 and 19 still hold, and the window is clean.
    const step = applyItem(practice, { type: "gap_fill", score: 1, session: 4 }, at(19));
    expect(step).toMatchObject({ mastered: true, firstMastery: true });
    const early = applyItem(practice, { type: "gap_fill", score: 1, session: 4 }, at(18));
    expect(early.mastered).toBe(false);
  });
});

describe("errors in free production", () => {
  test("an error on a learning topic only restarts the error-free window", () => {
    const learning = feed(EMPTY_PROGRESS, 2, 1, at(0)).progress;
    const step = applyTransfer(learning, "error", at(1));
    expect(step.progress).toMatchObject({ status: "learning", lastErrorAt: at(1) });
    expect(step.mastered).toBe(false);
  });

  test("an error on a mastered topic makes it shaky; its first mastery and card stay", () => {
    const start = mastered();
    const step = applyTransfer(start, "error", at(8));
    expect(step).toMatchObject({ from: "mastered", mastered: false });
    expect(step.progress).toMatchObject({ status: "shaky", masteredAt: null, lastErrorAt: at(8) });
    expect(step.progress.firstMasteredAt).toEqual(start.firstMasteredAt);
    expect(step.progress.fsrs).toEqual(start.fsrs);
  });

  test("an error on a shaky topic keeps it shaky", () => {
    const shaky = applyTransfer(mastered(), "error", at(8)).progress;
    expect(applyTransfer(shaky, "error", at(9)).progress.status).toBe("shaky");
  });

  test("an older error does not move the window back", () => {
    const erred = applyTransfer(EMPTY_PROGRESS, "error", at(10)).progress;
    expect(applyTransfer(erred, "error", at(2)).progress.lastErrorAt).toEqual(at(10));
  });

  test("a demoted topic is mastered again on a correct use 14 days on, not for the first time", () => {
    const shaky = applyTransfer(mastered(), "error", at(8)).progress;
    const early = applyTransfer(shaky, "correct", new Date(at(8).getTime() + ERROR_FREE_MS - 1));
    expect(early.progress.status).toBe("shaky");
    const step = applyTransfer(shaky, "correct", new Date(at(8).getTime() + ERROR_FREE_MS));
    expect(step).toMatchObject({ from: "shaky", mastered: true, firstMastery: false });
  });
});

describe("mastered → shaky by the window", () => {
  test("falling below the threshold makes it shaky", () => {
    const start = mastered();
    // Not due yet: same day, a session later. 7/8 still holds, 6/8 does not.
    const { progress, steps } = feed(start, 2, 0, at(7, 180), 4);
    expect(steps[0]?.progress.status).toBe("mastered");
    expect(progress.status).toBe("shaky");
    expect(progress.masteredAt).toBeNull();
    expect(progress.firstMasteredAt).not.toBeNull();
  });

  test("a shaky topic is mastered again once three newer sessions hold", () => {
    let progress = feed(mastered(), 2, 0, at(7, 180), 4).progress;
    progress = feed(progress, 4, 1, at(9), 5).progress;
    progress = feed(progress, 4, 1, at(12), 6).progress;
    expect(progress.status).toBe("shaky");
    const step = applyItem(progress, { type: "gap_fill", score: 1, session: 7 }, at(16));
    expect(step).toMatchObject({ from: "shaky", mastered: true, firstMastery: false });
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
    expect(isDue(mastered(), at(7, 180))).toBe(false);
    expect(isDue(EMPTY_PROGRESS, at(100))).toBe(false);
  });

  test(`${CHECK_ITEMS} right items pass it and reschedule it later`, () => {
    const { progress, when } = due();
    const { progress: after, steps } = feed(progress, CHECK_ITEMS, 1, when, 9);
    expect(steps.slice(0, -1).every((s) => s.checked === undefined)).toBe(true);
    expect(steps.at(-1)?.checked).toBe("passed");
    expect(after.status).toBe("mastered");
    expect(after.checkScores).toEqual([]);
    expect(after.reviewDue?.getTime()).toBeGreaterThan(progress.reviewDue?.getTime() ?? 0);
    expect(after.fsrs?.reps).toBe((progress.fsrs?.reps ?? 0) + 1);
  });

  test("a wrong check item sends it back to learning at once", () => {
    const { progress, when } = due();
    const right = applyItem(progress, { type: "gap_fill", score: 1, session: 9 }, when).progress;
    expect(right.checkScores).toEqual([1]);
    const step = applyItem(
      right,
      { type: "gap_fill", score: 0, session: 9 },
      new Date(when.getTime() + 60_000),
    );
    expect(step.checked).toBe("failed");
    expect(step.progress).toMatchObject({ status: "learning", checkScores: [], masteredAt: null });
    expect(step.progress.fsrs?.lapses).toBe((progress.fsrs?.lapses ?? 0) + 1);
  });

  test("partial credit passes the check, rated Hard — sooner than Good", () => {
    const { progress, when } = due();
    const partial = feed(progress, CHECK_ITEMS, 0.5, when, 9);
    const right = feed(progress, CHECK_ITEMS, 1, when, 9);
    expect(partial.last?.checked).toBe("passed");
    expect(partial.progress.reviewDue?.getTime()).toBeLessThan(
      right.progress.reviewDue?.getTime() ?? 0,
    );
    // Three halves take the window to 6.5/8 < 85 %: passed, but shaky.
    expect(partial.progress.status).toBe("shaky");
  });

  test("a failed check topic is mastered again later, not for the first time", () => {
    const { progress, when } = due();
    let failed = applyItem(progress, { type: "gap_fill", score: 0, session: 9 }, when).progress;
    const later = (days: number) => new Date(when.getTime() + days * DAY);
    failed = feed(failed, 4, 1, later(1), 10).progress;
    failed = feed(failed, 4, 1, later(4), 11).progress;
    expect(failed.status).toBe("learning");
    const step = applyItem(failed, { type: "gap_fill", score: 1, session: 12 }, later(8));
    expect(step).toMatchObject({ from: "learning", mastered: true, firstMastery: false });
  });
});
