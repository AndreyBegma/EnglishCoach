/**
 * The streak rules, pure (docs/PRODUCT.md → Gamification). Every date is a learner-local calendar
 * day as YYYY-MM-DD (`daily_stats.date`), so midnight and DST are settled once, where an instant
 * becomes a local date; here a day is a day, 23 or 25 hours long alike.
 *
 * A day is *kept* when its goal was met, a freeze bridged it, or a double goal the next day
 * restored it. A run is kept days in a row; it counts its goal days and restored days — a frozen
 * day keeps the run alive but adds nothing.
 */

/** Freezes a learner can hold; the weekly free one and purchases stop at this. */
export const MAX_FREEZES = 2;
/** What one bought freeze costs, in spendable XP. */
export const FREEZE_PRICE_XP = 200;
/** Streak lengths that pay a one-off bonus, and how much. */
export const STREAK_MILESTONES: ReadonlyMap<number, number> = new Map([
  [7, 50],
  [30, 150],
  [100, 500],
  [365, 1500],
]);

const DAY_MS = 24 * 60 * 60_000;

/** `date` moved by `days` calendar days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of `date`'s week (ISO weeks), the unit of the free freeze. */
export function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** A run of kept days. `days` counts its goal and restored days; frozen days only bridge. */
export interface Run {
  firstDay: string;
  lastDay: string;
  days: number;
}

export interface FreezeState {
  freezes: number;
  /** Monday of the last week whose free freeze was granted; null before the first. */
  grantedWeek: string | null;
}

export interface SettleOutcome extends FreezeState {
  /** Missed days a freeze now covers, oldest first; each is a `streak_days` row to write. */
  frozen: string[];
}

/**
 * Judges the days `from .. through` in order. On the first day of each new week one free freeze
 * is granted (never above `MAX_FREEZES`). A goal day extends the run; a missed day while the run
 * is alive spends a freeze, else the run breaks — and a broken run spends nothing more, so
 * freezes are not burnt on days nobody is protecting. `run` is the run's length the day before
 * `from`; `goalDays` holds the goal days in the window.
 */
export function settleDays(
  state: FreezeState,
  {
    from,
    through,
    run,
    goalDays,
  }: {
    from: string;
    through: string;
    run: number;
    goalDays: ReadonlySet<string>;
  },
): SettleOutcome {
  let { freezes, grantedWeek } = state;
  let alive = run;
  const frozen: string[] = [];
  for (let day = from; day <= through; day = addDays(day, 1)) {
    const week = weekStart(day);
    if (grantedWeek === null || week > grantedWeek) {
      freezes = Math.min(MAX_FREEZES, freezes + 1);
      grantedWeek = week;
    }
    if (goalDays.has(day)) alive += 1;
    else if (alive > 0 && freezes > 0) {
      freezes -= 1;
      frozen.push(day);
    } else alive = 0;
  }
  return { freezes, grantedWeek, frozen };
}

/** The streak as of `today`: the run ending today or yesterday (today may not be over yet). */
export function currentStreak(runs: readonly Run[], today: string): number {
  const yesterday = addDays(today, -1);
  const latest = runs.find((run) => run.lastDay === today || run.lastDay === yesterday);
  return latest?.days ?? 0;
}

/** A broken streak that a double goal today would restore. */
export interface RestoreOffer {
  /** The missed day a restore would keep. */
  missed: string;
  /** Days of the run the miss broke. */
  days: number;
}

/**
 * The restore window is the whole learner-local day after a break: yesterday was missed (no
 * goal, no freeze) and ended a run of at least one day. `runs` must already be settled.
 */
export function restoreOffer(runs: readonly Run[], today: string): RestoreOffer | undefined {
  const missed = addDays(today, -1);
  if (runs.some((run) => run.firstDay <= missed && run.lastDay >= missed)) return undefined;
  const broken = runs.find((run) => run.lastDay === addDays(missed, -1));
  return broken && broken.days > 0 ? { missed, days: broken.days } : undefined;
}

/** A day's counters, as `daily_stats` keeps them. */
export interface DayCounts {
  newWords: number;
  reviews: number;
  grammarAnswered: number;
}

/**
 * Twice the daily goal (`markGoalMet`'s rule): twice the day's new words, and at least two
 * reviews or grammar answers.
 */
export function doubleGoalMet(day: DayCounts | undefined, wordsPerDay: number): boolean {
  if (!day) return false;
  return day.newWords >= 2 * wordsPerDay && day.reviews + day.grammarAnswered >= 2;
}

/** Milestones the streak passed going from `before` to `after` days, each with its bonus. */
export function milestonesCrossed(before: number, after: number): { days: number; xp: number }[] {
  return [...STREAK_MILESTONES]
    .filter(([days]) => before < days && days <= after)
    .map(([days, xp]) => ({ days, xp }));
}
