import { and, eq, gte, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type DailyStats, dailyStats } from "../schema";

/** One day's counters for a learner; undefined when nothing happened that day. */
export async function getDailyStats(
  db: Db,
  userId: number,
  date: string,
): Promise<DailyStats | undefined> {
  const [row] = await db
    .select()
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, date)));
  return row;
}

/**
 * Sets `goal_met` for one day when the daily goal holds: today's new words are done and at least
 * one review or grammar answer happened. Monotonic — a met day is never unset, so lowering
 * `words_per_day` later cannot take it back and raising it cannot break a streak already earned.
 * Returns true only when this call flipped the flag.
 */
export async function markGoalMet(
  db: Db,
  userId: number,
  date: string,
  wordsPerDay: number,
): Promise<boolean> {
  const rows = await db
    .update(dailyStats)
    .set({ goalMet: true })
    .where(
      and(
        eq(dailyStats.userId, userId),
        eq(dailyStats.date, date),
        eq(dailyStats.goalMet, false),
        gte(dailyStats.newWords, wordsPerDay),
        or(gte(dailyStats.reviews, 1), gte(dailyStats.grammarAnswered, 1)),
      ),
    )
    .returning({ id: dailyStats.id });
  return rows.length > 0;
}

/** Whether the daily goal of `date` is met. */
export async function isGoalMet(db: Db, userId: number, date: string): Promise<boolean> {
  const [row] = await db
    .select({ goalMet: dailyStats.goalMet })
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, date)));
  return row?.goalMet ?? false;
}

/**
 * Patterns of the mistakes the learner made or repeated on their local `date`, most frequent
 * first — what the evening set practises.
 */
export async function mistakePatternsOn(
  db: Db,
  userId: number,
  date: string,
  timezone: string,
  limit: number,
): Promise<string[]> {
  const rows = await db.execute<{ pattern: string }>(
    sql`select pattern from mistakes
        where user_id = ${userId}
          and (last_seen_at at time zone ${timezone})::date = ${date}::date
        order by count desc, last_seen_at desc
        limit ${limit}`,
  );
  return rows.map((row) => row.pattern);
}
