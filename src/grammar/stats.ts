import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { dailyStats } from "../db/schema";

/** The learner's local calendar date as YYYY-MM-DD; UTC when the stored timezone is not valid. */
export function localDate(now: Date, timeZone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

/** Counts one graded grammar answer into today's `daily_stats` row; touches only `grammar_*`. */
export async function recordGrammarAnswer(
  db: Db,
  userId: number,
  timeZone: string,
  correct: boolean,
  now: Date = new Date(),
): Promise<void> {
  const gained = correct ? 1 : 0;
  await db
    .insert(dailyStats)
    .values({
      userId,
      date: localDate(now, timeZone),
      grammarAnswered: 1,
      grammarCorrect: gained,
    })
    .onConflictDoUpdate({
      target: [dailyStats.userId, dailyStats.date],
      set: {
        grammarAnswered: sql`${dailyStats.grammarAnswered} + 1`,
        grammarCorrect: sql`${dailyStats.grammarCorrect} + ${gained}`,
      },
    });
}
