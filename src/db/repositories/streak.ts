import { and, between, eq, sql } from "drizzle-orm";
import type { Run } from "../../progress/streak-rules";
import {
  dailyStats,
  type StreakDayKind,
  streakDays,
  type UserStreakRow,
  userStreak,
  userXp,
} from "../schema";
import type { Tx } from "./levels";

/**
 * The learner's streak row, created on first use and locked `for update` until the transaction
 * ends, so a settle, a restore and a purchase never interleave.
 */
export async function lockStreakState(tx: Tx, userId: number): Promise<UserStreakRow> {
  await tx.insert(userStreak).values({ userId }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(userStreak)
    .where(eq(userStreak.userId, userId))
    .for("update");
  if (!row) throw new Error(`user_streak row missing for user ${userId}`);
  return row;
}

/** Reads the streak row without locking; undefined before the first settle. */
export async function getStreakState(tx: Tx, userId: number): Promise<UserStreakRow | undefined> {
  const [row] = await tx.select().from(userStreak).where(eq(userStreak.userId, userId));
  return row;
}

export async function updateStreakState(
  tx: Tx,
  userId: number,
  patch: Partial<Pick<UserStreakRow, "freezes" | "grantedWeek" | "settledThrough" | "xpSpent">>,
  now: Date,
): Promise<void> {
  await tx
    .update(userStreak)
    .set({ ...patch, updatedAt: now })
    .where(eq(userStreak.userId, userId));
}

/** Records missed days that keep the streak; a day already recorded stays as it was. */
export async function insertStreakDays(
  tx: Tx,
  userId: number,
  dates: readonly string[],
  kind: StreakDayKind,
): Promise<void> {
  if (dates.length === 0) return;
  await tx
    .insert(streakDays)
    .values(dates.map((date) => ({ userId, date, kind })))
    .onConflictDoNothing();
}

/** The days in `from .. through` whose daily goal was met. */
export async function goalDaysBetween(
  tx: Tx,
  userId: number,
  from: string,
  through: string,
): Promise<Set<string>> {
  if (from > through) return new Set();
  const rows = await tx
    .select({ date: dailyStats.date })
    .from(dailyStats)
    .where(
      and(
        eq(dailyStats.userId, userId),
        eq(dailyStats.goalMet, true),
        between(dailyStats.date, from, through),
      ),
    );
  return new Set(rows.map((row) => row.date));
}

/**
 * Runs of kept days up to `through` (goal days and `streak_days`), newest first, and the longest
 * run ever. Only runs ending on `since` or later are returned. A run's `days` counts its goal and
 * restored days; frozen days only join their neighbours.
 */
export async function streakRuns(
  tx: Tx,
  userId: number,
  { through, since }: { through: string; since: string },
): Promise<{ runs: Run[]; best: number }> {
  const rows = await tx.execute<{
    first_day: string | null;
    last_day: string | null;
    days: string | null;
    best: string;
  }>(sql`
    with kept as (
      select date, bool_or(counts) as counts
      from (
        select date, true as counts from daily_stats
        where user_id = ${userId} and goal_met and date <= ${through}::date
        union all
        select date, kind = 'restore' from streak_days
        where user_id = ${userId} and date <= ${through}::date
      ) k
      group by date
    ),
    runs as (
      select min(date)::text as first_day, max(date)::text as last_day,
             count(*) filter (where counts) as days
      from (select date, counts, date - (row_number() over (order by date))::int as grp from kept) g
      group by grp
    )
    select r.first_day, r.last_day, r.days, b.best
    from (select coalesce(max(days), 0) as best from runs) b
    left join lateral (select * from runs where last_day >= ${since}) r on true
    order by r.last_day desc`);
  return {
    runs: rows.flatMap((row) =>
      row.first_day && row.last_day
        ? [{ firstDay: row.first_day, lastDay: row.last_day, days: Number(row.days) }]
        : [],
    ),
    best: Number(rows[0]?.best ?? 0),
  };
}

/** One day's counters, for the double-goal check; undefined when nothing happened that day. */
export async function dayCounts(
  tx: Tx,
  userId: number,
  date: string,
): Promise<{ newWords: number; reviews: number; grammarAnswered: number } | undefined> {
  const [row] = await tx
    .select({
      newWords: dailyStats.newWords,
      reviews: dailyStats.reviews,
      grammarAnswered: dailyStats.grammarAnswered,
    })
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, date)));
  return row;
}

/** XP the learner can spend: earned XP less what freezes already took. */
export async function spendableXp(tx: Tx, userId: number): Promise<number> {
  const [row] = await tx
    .select({ total: userXp.total })
    .from(userXp)
    .where(eq(userXp.userId, userId));
  const state = await getStreakState(tx, userId);
  return Math.max(0, (row?.total ?? 0) - (state?.xpSpent ?? 0));
}
