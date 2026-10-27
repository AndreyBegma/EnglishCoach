import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { achievementProgress, type UserAchievementRow, userAchievements } from "../schema";
import type { Tx } from "./levels";

/** How an event moves a counter: add to it, raise it to at least a value, or overwrite it. */
export type CounterUpdate =
  | { metric: string; op: "add"; by: number }
  | { metric: string; op: "max"; value: number }
  | { metric: string; op: "set"; value: number };

/** Applies counter updates (creating the counters) and returns each touched counter's new value. */
export async function applyCounterUpdates(
  tx: Tx,
  userId: number,
  updates: readonly CounterUpdate[],
  now: Date,
): Promise<Map<string, number>> {
  const values = new Map<string, number>();
  for (const update of updates) {
    const initial = update.op === "add" ? update.by : update.value;
    const value =
      update.op === "add"
        ? sql`${achievementProgress.value} + ${update.by}`
        : update.op === "max"
          ? sql`greatest(${achievementProgress.value}, ${update.value})`
          : sql`${update.value}`;
    const [row] = await tx
      .insert(achievementProgress)
      .values({ userId, metric: update.metric, value: initial, updatedAt: now })
      .onConflictDoUpdate({
        target: [achievementProgress.userId, achievementProgress.metric],
        set: { value, updatedAt: now },
      })
      .returning({ value: achievementProgress.value });
    values.set(update.metric, Number(row?.value ?? initial));
  }
  return values;
}

/** Every counter of the learner, by metric. */
export async function getCounters(db: Tx, userId: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ metric: achievementProgress.metric, value: achievementProgress.value })
    .from(achievementProgress)
    .where(eq(achievementProgress.userId, userId));
  return new Map(rows.map((row) => [row.metric, Number(row.value)]));
}

/** Inserts unlocks that do not exist yet; returns the ids this call actually unlocked. */
export async function insertUnlocks(
  tx: Tx,
  userId: number,
  achievementIds: readonly string[],
  now: Date,
): Promise<string[]> {
  if (achievementIds.length === 0) return [];
  const rows = await tx
    .insert(userAchievements)
    .values(achievementIds.map((achievementId) => ({ userId, achievementId, unlockedAt: now })))
    .onConflictDoNothing()
    .returning({ achievementId: userAchievements.achievementId });
  return rows.map((row) => row.achievementId);
}

/** The learner's unlocks, newest first. */
export async function listUnlocks(
  db: Tx,
  userId: number,
  limit?: number,
): Promise<UserAchievementRow[]> {
  const query = db
    .select()
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId))
    .orderBy(desc(userAchievements.unlockedAt), desc(userAchievements.achievementId));
  return limit === undefined ? query : query.limit(limit);
}

/** Unlocks the hub has not shown yet, oldest first. */
export async function listUnnotified(db: Tx, userId: number): Promise<UserAchievementRow[]> {
  return db
    .select()
    .from(userAchievements)
    .where(and(eq(userAchievements.userId, userId), isNull(userAchievements.notifiedAt)))
    .orderBy(userAchievements.unlockedAt, userAchievements.achievementId);
}

export async function markNotified(
  db: Tx,
  userId: number,
  achievementIds: readonly string[],
  now: Date,
): Promise<void> {
  if (achievementIds.length === 0) return;
  await db
    .update(userAchievements)
    .set({ notifiedAt: now })
    .where(
      and(
        eq(userAchievements.userId, userId),
        inArray(userAchievements.achievementId, [...achievementIds]),
        isNull(userAchievements.notifiedAt),
      ),
    );
}
