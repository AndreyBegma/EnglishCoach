import type { XpSource } from "../db/schema";

/**
 * The XP rules, pure: what each kind of effort is worth and how XP turns into a profile level.
 * XP rewards quality and effort, not volume — an item is worth more the harder it is for the
 * learner, and an item far below the learner's level is worth nothing, so grinding easy items
 * does not pay. The level model (`src/levels/`) says how hard an item is for whom; every amount
 * here is computed by the server, never by the model.
 */

/** XP for one fully right item pitched at the learner's level, by source. */
export const BASE_XP = {
  grammar_item: 10,
  review: 4,
  word_learned: 6,
  talk_turn: 8,
} as const satisfies Partial<Record<XpSource, number>>;

export type ItemSource = keyof typeof BASE_XP;

/** A syllabus topic's first mastery (`src/grammar/mastery.ts` decides it); awarded once. */
export const TOPIC_MASTERED_XP = 50;

export const DAILY_GOAL_XP = 30;
/** Streak bonus on a day the goal is met: this much per day of the streak, from day 2… */
export const STREAK_XP_PER_DAY = 5;
/** …up to this much a day, so a long streak is rewarded but never dominates a day's XP. */
export const STREAK_XP_CAP = 50;

/** An item this much above the learner (in CEFR bands, or more) earns the full bonus… */
export const ABOVE_FULL_GAP = 1;
/** …which is this multiplier. */
export const MAX_MULTIPLIER = 1.5;
/** Items up to this far below the learner's rating still count in full (the level is a guess). */
export const AT_LEVEL_WINDOW = 0.5;
/** Below that window the multiplier halves every this many bands: the anti-farming rule. */
export const FARMING_HALF_LIFE = 0.5;

/**
 * The difficulty multiplier of an item pitched at `itemLevel` for a learner rated `rating`, both
 * on the level model's scale (A1.0 = 0, one band = 1). Rises linearly to `MAX_MULTIPLIER` for an
 * item a band or more above the learner, is 1 at the learner's level, and decays exponentially
 * for items more than half a band below it: two bands below is worth an eighth.
 */
export function difficultyMultiplier(itemLevel: number, rating: number): number {
  const gap = itemLevel - rating;
  if (gap >= 0) return 1 + (MAX_MULTIPLIER - 1) * Math.min(gap / ABOVE_FULL_GAP, 1);
  if (gap >= -AT_LEVEL_WINDOW) return 1;
  return 0.5 ** ((-gap - AT_LEVEL_WINDOW) / FARMING_HALF_LIFE);
}

/**
 * XP for one graded item: its base × its score (0..1, partial credit in between) × the
 * difficulty multiplier, rounded down — so an item far enough below the learner earns 0.
 */
export function itemXp(
  source: ItemSource,
  score: number,
  itemLevel: number,
  rating: number,
): number {
  const credit = Math.min(1, Math.max(0, score));
  return Math.floor(BASE_XP[source] * credit * difficultyMultiplier(itemLevel, rating));
}

/** The streak bonus on a goal-met day, `streak` counting that day; nothing for a first day. */
export function streakXp(streak: number): number {
  if (streak < 2) return 0;
  return Math.min(STREAK_XP_CAP, STREAK_XP_PER_DAY * streak);
}

/** XP to go from level 1 to 2; each next level costs `LEVEL_GROWTH` times the previous one. */
export const LEVEL_BASE_XP = 100;
export const LEVEL_GROWTH = 1.15;

/** XP needed to go from `level` to `level + 1`: `round(100 × 1.15^(level − 1))`. */
export function xpToNext(level: number): number {
  return Math.round(LEVEL_BASE_XP * LEVEL_GROWTH ** (Math.max(1, level) - 1));
}

export type ProfileLevel = {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level takes in all; `into < needed`. */
  needed: number;
};

/** The profile level a total reaches, and how far into it. Everyone starts at level 1 with 0 XP. */
export function profileLevel(total: number): ProfileLevel {
  let level = 1;
  let left = Math.max(0, Math.floor(total));
  while (left >= xpToNext(level)) {
    left -= xpToNext(level);
    level += 1;
  }
  return { level, into: left, needed: xpToNext(level) };
}
