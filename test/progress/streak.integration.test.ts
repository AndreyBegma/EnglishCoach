import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { getStreakState } from "../../src/db/repositories/streak";
import { addToXpTotal } from "../../src/db/repositories/xp";
import { dailyStats, streakDays as streakDaysTable, users, userXp } from "../../src/db/schema";
import { buyFreeze, restoreStreak, streakDays } from "../../src/progress/streak";
import { FREEZE_PRICE_XP, MAX_FREEZES } from "../../src/progress/streak-rules";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const TZ = "Europe/Kyiv";

describe.skipIf(!testServerUrl)("streak freezes and restore", () => {
  let database: Database;
  let nextTelegramId = 993_001;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  async function learner(goalDays: string[], extra: (typeof dailyStats.$inferInsert)[] = []) {
    const [user] = await database.db
      .insert(users)
      .values({ telegramId: nextTelegramId++, isAllowed: true })
      .returning();
    const userId = user?.id ?? 0;
    const rows = goalDays.map((date) => ({
      userId,
      date,
      goalMet: true,
      newWords: 5,
      reviews: 1,
    }));
    const all = [...rows, ...extra.map((row) => ({ ...row, userId }))];
    if (all.length) await database.db.insert(dailyStats).values(all);
    return userId;
  }

  const frozenDays = async (userId: number) =>
    (
      await database.db.select().from(streakDaysTable).where(eq(streakDaysTable.userId, userId))
    ).map((row) => [row.date, row.kind]);

  test("a missed day spends the weekly freeze, is recorded, and is judged only once", async () => {
    const userId = await learner(["2026-03-13", "2026-03-14", "2026-03-15"]);
    // First read on the 16th in Kyiv (Monday): settles Sunday the 15th, granting that week's freeze.
    const monday = new Date("2026-03-16T10:00:00Z");
    expect(await streakDays(database.db, userId, { now: monday, timezone: TZ })).toMatchObject({
      current: 3,
      freezes: 1,
    });
    // The 16th brings the new week's freeze and is missed: one of the two keeps the run (a frozen
    // day does not count).
    const tuesday = new Date("2026-03-17T10:00:00Z");
    const kept = await streakDays(database.db, userId, { now: tuesday, timezone: TZ });
    expect(kept).toMatchObject({ current: 3, freezes: 1, since: "2026-03-13" });
    expect(kept.restore).toBeUndefined();
    expect(await frozenDays(userId)).toEqual([["2026-03-16", "freeze"]]);
    // Reading again changes nothing.
    await streakDays(database.db, userId, { now: tuesday, timezone: TZ });
    expect(await frozenDays(userId)).toEqual([["2026-03-16", "freeze"]]);
    expect((await getStreakState(database.db, userId))?.settledThrough).toBe("2026-03-16");
    // Goal met on the 17th: the run carries on over the frozen day.
    await database.db
      .insert(dailyStats)
      .values({ userId, date: "2026-03-17", goalMet: true, newWords: 5, reviews: 1 });
    expect(await streakDays(database.db, userId, { now: tuesday, timezone: TZ })).toMatchObject({
      current: 4,
    });
  });

  test("across user-local midnight: the freeze is spent only once the local day is over", async () => {
    const userId = await learner(["2026-03-14", "2026-03-15"]);
    // 21:59Z on the 16th is 23:59 in Kyiv: the 16th is still today, nothing is judged yet.
    const beforeMidnight = new Date("2026-03-16T21:59:00Z");
    await streakDays(database.db, userId, { now: beforeMidnight, timezone: TZ });
    expect(await frozenDays(userId)).toEqual([]);
    // One minute later it is the 17th there: the 16th is missed and frozen.
    const afterMidnight = new Date("2026-03-16T22:00:00Z");
    expect(
      await streakDays(database.db, userId, { now: afterMidnight, timezone: TZ }),
    ).toMatchObject({ current: 2 });
    expect(await frozenDays(userId)).toEqual([["2026-03-16", "freeze"]]);
  });

  test("a double goal on the day after a break restores it — across spring-forward", async () => {
    // Run 24-27 March; the 28th is missed with no freeze; the 29th (23 h in Kyiv) is the window.
    const userId = await learner(["2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27"]);
    const early = new Date("2026-03-27T10:00:00Z");
    await streakDays(database.db, userId, { now: early, timezone: TZ });
    await spendFreezes(userId);
    const lateOn29th = new Date("2026-03-29T20:30:00Z"); // 23:30 EEST
    const broken = await streakDays(database.db, userId, { now: lateOn29th, timezone: TZ });
    expect(broken).toMatchObject({ current: 0, restore: { missed: "2026-03-28", days: 4 } });

    // A single goal is not enough.
    await database.db
      .insert(dailyStats)
      .values({ userId, date: "2026-03-29", goalMet: true, newWords: 5, reviews: 1 });
    const single = { now: lateOn29th, timezone: TZ, wordsPerDay: 5 };
    expect(await restoreStreak(database.db, userId, single)).toBeUndefined();

    await database.db
      .update(dailyStats)
      .set({ newWords: 10, reviews: 2 })
      .where(eq(dailyStats.userId, userId));
    expect(await restoreStreak(database.db, userId, single)).toEqual({
      missed: "2026-03-28",
      before: 1,
      after: 6,
      since: "2026-03-24",
    });
    // Once: the offer is gone and a replay restores nothing.
    expect(await restoreStreak(database.db, userId, single)).toBeUndefined();
    expect(await streakDays(database.db, userId, { now: lateOn29th, timezone: TZ })).toMatchObject({
      current: 6,
      restore: undefined,
    });
  });

  test("the restore window closes at the next local midnight", async () => {
    const userId = await learner(
      ["2026-03-24", "2026-03-25"],
      [{ userId: 0, date: "2026-03-27", newWords: 10, reviews: 2 }],
    );
    await streakDays(database.db, userId, { now: new Date("2026-03-25T10:00:00Z"), timezone: TZ });
    await spendFreezes(userId);
    // The 26th was missed; the 27th's double goal counts only while it is the 27th in Kyiv.
    const next = new Date("2026-03-27T22:00:00Z"); // 00:00 on the 28th, EET
    expect(
      await restoreStreak(database.db, userId, { now: next, timezone: TZ, wordsPerDay: 5 }),
    ).toBeUndefined();
  });

  test("a freeze costs spendable XP, stops at the cap, and never lowers the earned total", async () => {
    const userId = await learner([]);
    const clock = { now: new Date("2026-03-18T10:00:00Z"), timezone: TZ };
    // The first settle grants this week's free one: one left below the cap.
    expect(await buyFreeze(database.db, userId, clock)).toBe("poor");
    await addToXpTotal(database.db, userId, FREEZE_PRICE_XP + 50, clock.now);
    expect(await buyFreeze(database.db, userId, clock)).toBe("bought");
    expect(await buyFreeze(database.db, userId, clock)).toBe("full");
    const state = await getStreakState(database.db, userId);
    expect(state).toMatchObject({ freezes: MAX_FREEZES, xpSpent: FREEZE_PRICE_XP });
    const [xp] = await database.db.select().from(userXp).where(eq(userXp.userId, userId));
    expect(xp?.total).toBe(FREEZE_PRICE_XP + 50);
  });

  test("two taps at once buy one freeze", async () => {
    const userId = await learner([]);
    const clock = { now: new Date("2026-03-18T10:00:00Z"), timezone: TZ };
    await addToXpTotal(database.db, userId, FREEZE_PRICE_XP * 3, clock.now);
    const outcomes = await Promise.all([
      buyFreeze(database.db, userId, clock),
      buyFreeze(database.db, userId, clock),
    ]);
    expect(outcomes.sort()).toEqual(["bought", "full"]);
    expect((await getStreakState(database.db, userId))?.xpSpent).toBe(FREEZE_PRICE_XP);
  });

  /** Empties the learner's stock, with this and every earlier week's free freeze granted. */
  async function spendFreezes(userId: number) {
    const { userStreak } = await import("../../src/db/schema");
    await database.db
      .update(userStreak)
      .set({ freezes: 0, grantedWeek: "2026-12-28" })
      .where(eq(userStreak.userId, userId));
  }
});
