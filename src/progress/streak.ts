import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { localDate } from "../grammar/stats";

export interface Streak {
  current: number;
  best: number;
}

/**
 * Streak of days on which the daily goal was met (`daily_stats.goal_met`, keyed by the learner's
 * local date). `best` is the longest run of consecutive days ever; `current` is the run that ends
 * today or yesterday, since today may not be over yet. Read-only: `goal_met` is written by the
 * daily routine, not here. `timezone` is the learner's IANA zone (UTC if it does not parse).
 */
export async function streakDays(
  db: Db,
  userId: number,
  { now, timezone }: { now: Date; timezone: string },
): Promise<Streak> {
  const today = localDate(now, timezone);
  const rows = await db.execute<{ current: string; best: string }>(sql`
    select coalesce(max(len) filter (where last_day >= ${today}::date - 1), 0) as current,
           coalesce(max(len), 0) as best
    from (
      select count(*) as len, max(date) as last_day
      from (
        select date, date - (row_number() over (order by date))::int as grp
        from daily_stats
        where user_id = ${userId} and goal_met and date <= ${today}::date
      ) days
      group by grp
    ) runs`);
  return { current: Number(rows[0]?.current ?? 0), best: Number(rows[0]?.best ?? 0) };
}
