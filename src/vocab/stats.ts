import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { dailyStats } from "../db/schema";

/** The learner's calendar date in their timezone, as YYYY-MM-DD (`daily_stats.date`). */
export function localDate(now: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** New words learned on `date`. */
export async function newWordsOn(db: Db, userId: number, date: string): Promise<number> {
  const [row] = await db
    .select({ newWords: dailyStats.newWords })
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, date)));
  return row?.newWords ?? 0;
}

/** Adds to the vocabulary counters of one day. Only this module writes these two columns. */
export async function addVocabStats(
  db: Db,
  userId: number,
  date: string,
  delta: { newWords?: number; reviews?: number },
): Promise<void> {
  const newWords = delta.newWords ?? 0;
  const reviews = delta.reviews ?? 0;
  await db
    .insert(dailyStats)
    .values({ userId, date, newWords, reviews })
    .onConflictDoUpdate({
      target: [dailyStats.userId, dailyStats.date],
      set: {
        newWords: sql`${dailyStats.newWords} + ${newWords}`,
        reviews: sql`${dailyStats.reviews} + ${reviews}`,
      },
    });
}
