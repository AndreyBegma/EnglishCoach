import type { CefrLevel } from "../db/schema/enums";
import type { Skill } from "../db/schema/levels";
import { CEFR_LEVELS } from "../settings/options";

/**
 * The level model, pure. A rating is a point on the CEFR scale: the band's index plus the
 * fraction of the band covered, so A1.0 = 0, B1.6 = 2.6 and C2.9 = 5.9. An item's difficulty is
 * on the same scale. After each graded item the rating moves IRT-lite style (a one-parameter
 * logistic model, updated like a Kalman filter): the chance of success is
 * `logistic((rating − difficulty) / SCALE)`, and the step is the surprise times the current
 * variance, so an uncertain rating moves fast and a well-evidenced one barely moves.
 */

export const SKILLS = [
  "grammar",
  "vocabulary",
  "reading",
  "listening",
  "writing",
  "speaking",
] as const satisfies readonly Skill[];

/** One band apart, the stronger side succeeds about 79 % of the time. */
export const SCALE = 0.75;
export const MIN_RATING = 0;
/** C2.9, the top of the scale as it is shown. */
export const MAX_RATING = 5.9;

/** What nothing is known about: the middle of B1, about as unsure as the whole scale allows. */
export const PRIOR = { rating: 2.5, uncertainty: 1.5 } as const;
/** Never this sure: a learner changes, so the rating keeps listening to new evidence. */
export const MIN_UNCERTAINTY = 0.2;
/** Variance a rating loses its certainty by per idle day. */
export const DRIFT_PER_DAY = 0.002;

/** How sure a seeded level is, by where it came from. The migration uses `chosen`. */
export const SEEDED_UNCERTAINTY = { placement: 0.6, chosen: 0.8 } as const;

/** Base weights of the overall level; each is divided by the skill's variance. */
export const OVERALL_WEIGHTS: Record<Skill, number> = {
  grammar: 1,
  vocabulary: 1,
  reading: 1,
  listening: 1,
  writing: 1,
  speaking: 1,
};

export type LevelState = { rating: number; uncertainty: number };

const DAY_MS = 24 * 60 * 60 * 1000;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clampRating = (rating: number) => clamp(rating, MIN_RATING, MAX_RATING);

/** The rating in the middle of a band: what a band-only fact (a word's level, a choice) means. */
export function bandCentre(level: CefrLevel): number {
  return CEFR_LEVELS.indexOf(level) + 0.5;
}

/** Tenths of the scale; the epsilon keeps 2.3 (2.2999…) from showing as B1.2. */
const tenths = (rating: number) => Math.floor(clampRating(rating) * 10 + 1e-9);

/** The band a rating falls in. */
export function bandOf(rating: number): CefrLevel {
  return CEFR_LEVELS[Math.floor(tenths(rating) / 10)] ?? "C2";
}

/** A rating as the learner sees it: "B1.6". Truncated, so B1.9 is still B1. */
export function formatCefr(rating: number): string {
  const t = tenths(rating);
  return `${CEFR_LEVELS[Math.floor(t / 10)]}.${t % 10}`;
}

const DECIMAL = /^([ABC][12])\.(\d)$/;

/** "B1.6" → 2.6; undefined for anything that is not a CEFR decimal. */
export function parseCefr(text: string): number | undefined {
  const match = DECIMAL.exec(text.trim());
  const index = CEFR_LEVELS.indexOf((match?.[1] ?? "") as CefrLevel);
  if (!match || index === -1) return undefined;
  return (index * 10 + Number(match[2])) / 10;
}

/** Chance of a full score on an item of `difficulty` at `rating`. */
export function expectedScore(rating: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-(rating - difficulty) / SCALE));
}

/**
 * The difficulty to rate against for an item pitched at `level` when a learner of exactly that
 * level is meant to score `expected` on it (a quiz aimed at 65 %, a review aimed at 90 %
 * retention): without the shift, a by-design success rate would read as a higher level.
 */
export function pitched(level: number, expected: number): number {
  const p = clamp(expected, 0.01, 0.99);
  return level - SCALE * Math.log(p / (1 - p));
}

/** Widens the uncertainty for the days since the last update; a long break makes it move again. */
export function drift(state: LevelState, idleMs: number): LevelState {
  const days = Math.max(0, idleMs) / DAY_MS;
  const variance = Math.min(PRIOR.uncertainty ** 2, state.uncertainty ** 2 + DRIFT_PER_DAY * days);
  return { rating: state.rating, uncertainty: Math.max(state.uncertainty, Math.sqrt(variance)) };
}

/**
 * One graded item: `score` in 0..1 (1 = fully right, partial credit in between) on an item of
 * `difficulty`. The variance shrinks by the item's information, then the rating moves by the
 * surprise (`score − expected`) weighted by the new variance.
 */
export function update(state: LevelState, difficulty: number, score: number): LevelState {
  const y = clamp(score, 0, 1);
  const p = expectedScore(state.rating, difficulty);
  const information = (p * (1 - p)) / SCALE ** 2;
  const variance = Math.max(MIN_UNCERTAINTY ** 2, 1 / (1 / state.uncertainty ** 2 + information));
  return {
    rating: clampRating(state.rating + (variance * (y - p)) / SCALE),
    uncertainty: Math.sqrt(variance),
  };
}

/**
 * The overall level: a weighted mean of the skills that have a level, each weighted by its base
 * weight over its variance, so practised skills count more than seeded ones. Its uncertainty is
 * that of a weighted mean. Undefined when no skill has a level.
 */
export function overall(levels: Partial<Record<Skill, LevelState>>): LevelState | undefined {
  let sum = 0;
  let weights = 0;
  for (const skill of SKILLS) {
    const level = levels[skill];
    if (!level) continue;
    const weight = OVERALL_WEIGHTS[skill] / level.uncertainty ** 2;
    sum += weight * level.rating;
    weights += weight;
  }
  if (weights === 0) return undefined;
  return { rating: clampRating(sum / weights), uncertainty: Math.sqrt(1 / weights) };
}
