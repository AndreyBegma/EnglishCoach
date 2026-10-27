import type { Db } from "../db/client";
import type { Tx } from "../db/repositories/levels";
import {
  dayCounts,
  getStreakState,
  goalDaysBetween,
  insertStreakDays,
  lockStreakState,
  streakRuns,
  updateStreakState,
} from "../db/repositories/streak";
import { getUserXp } from "../db/repositories/xp";
import type { UserStreakRow } from "../db/schema";
import { localDate } from "../routine/time";
import {
  addDays,
  currentStreak,
  doubleGoalMet,
  FREEZE_PRICE_XP,
  MAX_FREEZES,
  type RestoreOffer,
  restoreOffer,
  settleDays,
} from "./streak-rules";

export interface Streak {
  current: number;
  best: number;
  /** First day of the current run; undefined when there is none. */
  since?: string;
  /** Freezes in stock. */
  freezes: number;
  /** Set while a double goal today would restore the streak yesterday broke. */
  restore?: RestoreOffer;
}

/** The learner's local date and clock, for every streak call. */
export interface StreakClock {
  now: Date;
  /** IANA zone (UTC if it does not parse). */
  timezone: string;
}

/**
 * Judges the learner's missed days up to yesterday, under the row lock `state` came from: grants
 * the weekly freezes and spends them on missed days of a live run (`settleDays`), and records
 * every frozen day. Idempotent: a settled day is never judged again.
 */
async function settleLocked(
  tx: Tx,
  state: UserStreakRow,
  userId: number,
  today: string,
  now: Date,
): Promise<UserStreakRow> {
  const through = addDays(today, -1);
  const from = state.settledThrough ? addDays(state.settledThrough, 1) : through;
  if (from > through) return state;
  const before = addDays(from, -1);
  const { runs } = await streakRuns(tx, userId, { through: before, since: before });
  const goalDays = await goalDaysBetween(tx, userId, from, through);
  const outcome = settleDays(state, { from, through, run: runs[0]?.days ?? 0, goalDays });
  await insertStreakDays(tx, userId, outcome.frozen, "freeze");
  const patch = {
    freezes: outcome.freezes,
    grantedWeek: outcome.grantedWeek,
    settledThrough: through,
  };
  await updateStreakState(tx, userId, patch, now);
  return { ...state, ...patch };
}

/** Settles the learner's streak through yesterday unless that is done already. */
export async function settleStreak(db: Db, userId: number, { now, timezone }: StreakClock) {
  const today = localDate(now, timezone);
  const state = await getStreakState(db, userId);
  if (state?.settledThrough && state.settledThrough >= addDays(today, -1)) return;
  await db.transaction(async (tx) => {
    await settleLocked(tx, await lockStreakState(tx, userId), userId, today, now);
  });
}

/**
 * The learner's streak (rules in `./streak-rules`): `current` is the run that ends today or
 * yesterday, since today may not be over yet; `best` is the longest run ever. Settles missed days
 * first, so a freeze is spent (or the streak broken) on the first read after a missed day.
 */
export async function streakDays(db: Db, userId: number, clock: StreakClock): Promise<Streak> {
  await settleStreak(db, userId, clock);
  const today = localDate(clock.now, clock.timezone);
  const [{ runs, best }, state] = await Promise.all([
    streakRuns(db, userId, { through: today, since: addDays(today, -2) }),
    getStreakState(db, userId),
  ]);
  const current = currentStreak(runs, today);
  const yesterday = addDays(today, -1);
  return {
    current,
    best,
    since: runs.find((run) => run.days > 0 && run.lastDay >= yesterday)?.firstDay,
    freezes: state?.freezes ?? 0,
    restore: restoreOffer(runs, today),
  };
}

/** A restore that just happened: the streak before and after it. */
export interface Restored {
  missed: string;
  before: number;
  after: number;
  /** First day of the restored run. */
  since: string;
}

/**
 * Restores yesterday's broken streak when today's counters reach a double goal (`doubleGoalMet`)
 * inside the restore window (`restoreOffer`). Once: the restored day is kept from then on, so
 * the offer is gone. Undefined when nothing was restored.
 */
export async function restoreStreak(
  db: Db,
  userId: number,
  { now, timezone, wordsPerDay }: StreakClock & { wordsPerDay: number },
): Promise<Restored | undefined> {
  const today = localDate(now, timezone);
  return db.transaction(async (tx) => {
    await settleLocked(tx, await lockStreakState(tx, userId), userId, today, now);
    if (!doubleGoalMet(await dayCounts(tx, userId, today), wordsPerDay)) return undefined;
    const window = { through: today, since: addDays(today, -2) };
    const { runs } = await streakRuns(tx, userId, window);
    const offer = restoreOffer(runs, today);
    if (!offer) return undefined;
    await insertStreakDays(tx, userId, [offer.missed], "restore");
    const after = (await streakRuns(tx, userId, window)).runs;
    const run = after.find((candidate) => candidate.lastDay >= offer.missed);
    return {
      missed: offer.missed,
      before: currentStreak(runs, today),
      after: currentStreak(after, today),
      since: run?.firstDay ?? offer.missed,
    };
  });
}

export type FreezePurchase = "bought" | "full" | "poor";

/**
 * Buys one freeze for `FREEZE_PRICE_XP` spendable XP, while the learner holds fewer than
 * `MAX_FREEZES`. Spending never lowers the earned XP or the profile level.
 */
export async function buyFreeze(
  db: Db,
  userId: number,
  clock: StreakClock,
): Promise<FreezePurchase> {
  const today = localDate(clock.now, clock.timezone);
  return db.transaction(async (tx) => {
    const state = await settleLocked(
      tx,
      await lockStreakState(tx, userId),
      userId,
      today,
      clock.now,
    );
    if (state.freezes >= MAX_FREEZES) return "full";
    const earned = (await getUserXp(tx, userId))?.total ?? 0;
    if (earned - state.xpSpent < FREEZE_PRICE_XP) return "poor";
    await updateStreakState(
      tx,
      userId,
      { freezes: state.freezes + 1, xpSpent: state.xpSpent + FREEZE_PRICE_XP },
      clock.now,
    );
    return "bought";
  });
}
