import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  addMissingSkillLevels,
  listSkillLevels,
  lockSkillLevel,
  putSkillLevels,
  type Tx,
} from "../db/repositories/levels";
import { type CefrLevel, type Skill, type SkillLevelRow, userSettings } from "../db/schema";
import {
  bandCentre,
  bandOf,
  drift,
  formatCefr,
  type LevelState,
  overall,
  PRIOR,
  pitched,
  SEEDED_UNCERTAINTY,
  SKILLS,
  update,
} from "./model";

/**
 * What a graded item was pitched at: a CEFR band (a syllabus topic, a word's level), a rating on
 * the model's scale, or null for an item pitched at the learner's own current level in that skill
 * (a learner's own word, a free conversation turn).
 */
export type Difficulty = CefrLevel | number | null;

export type Level = { rating: number; uncertainty: number; label: string; band: CefrLevel };

const asLevel = (state: LevelState): Level => ({
  rating: state.rating,
  uncertainty: state.uncertainty,
  label: formatCefr(state.rating),
  band: bandOf(state.rating),
});

const levelOf = (difficulty: Difficulty, rating: number) =>
  difficulty === null
    ? rating
    : typeof difficulty === "number"
      ? difficulty
      : bandCentre(difficulty);

export type RecordOptions = {
  /**
   * What a learner of exactly the item's level scores on such items on average: 0.5 (the default)
   * for a fresh test item, more for item kinds built to be passed (see `ITEM_EXPECTED`).
   */
  expected?: number;
  now?: Date;
};

/**
 * Rewrites `user_settings.cefr_level`, the cache of the overall level's band, from the skill
 * levels. A learner without a level yet (null: placement not run, no level chosen) keeps none:
 * that null is what sends them through onboarding.
 */
async function refreshCache(tx: Tx, userId: number): Promise<void> {
  const rows = await listSkillLevels(tx, userId);
  const level = overall(Object.fromEntries(rows.map((row) => [row.skill, row])));
  if (!level) return;
  const [settings] = await tx
    .select({ cefrLevel: userSettings.cefrLevel })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  const band = bandOf(level.rating);
  if (!settings?.cefrLevel || settings.cefrLevel === band) return;
  await tx.update(userSettings).set({ cefrLevel: band }).where(eq(userSettings.userId, userId));
}

/**
 * A learner whose level exists only as the cached band (set before the model, or written by a
 * path that never seeded) gets every missing skill at that band, as if they had chosen it, so
 * the first graded item does not start from the prior and drag the cache away. Returns the
 * skill's row, locked, or undefined for a learner with no level at all.
 */
async function backfillFromCache(
  tx: Tx,
  userId: number,
  skill: Skill,
  now: Date,
): Promise<SkillLevelRow | undefined> {
  const [settings] = await tx
    .select({ cefrLevel: userSettings.cefrLevel })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  if (!settings?.cefrLevel) return undefined;
  const rating = bandCentre(settings.cefrLevel);
  const uncertainty = SEEDED_UNCERTAINTY.chosen;
  await addMissingSkillLevels(
    tx,
    userId,
    SKILLS.map((each) => ({ skill: each, rating, uncertainty, evidence: 0 })),
    now,
  );
  return lockSkillLevel(tx, userId, skill);
}

/**
 * The one entry point every grader calls after it has graded an item: `score` is 0..1 (partial
 * credit in between), `difficulty` what the item was pitched at. Moves the skill's rating, then
 * the overall level's cache. A skill with no level yet starts from the prior.
 */
export async function recordGradedItem(
  db: Db,
  userId: number,
  skill: Skill,
  difficulty: Difficulty,
  score: number,
  { expected = 0.5, now = new Date() }: RecordOptions = {},
): Promise<Level> {
  return db.transaction(async (tx) => {
    const row =
      (await lockSkillLevel(tx, userId, skill)) ??
      (await backfillFromCache(tx, userId, skill, now));
    const current = row ? drift(row, now.getTime() - row.updatedAt.getTime()) : PRIOR;
    const at = pitched(levelOf(difficulty, current.rating), expected);
    const next = update(current, at, score);
    await putSkillLevels(tx, userId, [{ skill, ...next, evidence: (row?.evidence ?? 0) + 1 }], now);
    await refreshCache(tx, userId);
    return asLevel(next);
  });
}

/**
 * Starts every skill at `level` — the placement result or a level the learner chose — dropping
 * the evidence behind the old ratings, and sets the cache to it.
 */
export async function seedLevels(
  db: Db,
  userId: number,
  level: CefrLevel,
  source: keyof typeof SEEDED_UNCERTAINTY,
  now: Date = new Date(),
): Promise<void> {
  const rating = bandCentre(level);
  const uncertainty = SEEDED_UNCERTAINTY[source];
  await db.transaction(async (tx) => {
    await putSkillLevels(
      tx,
      userId,
      SKILLS.map((skill) => ({ skill, rating, uncertainty, evidence: 0 })),
      now,
    );
    await tx.update(userSettings).set({ cefrLevel: level }).where(eq(userSettings.userId, userId));
  });
}

export type Levels = {
  overall: Level;
  skills: Partial<Record<Skill, Level & { evidence: number }>>;
};

type LevelRow = Pick<SkillLevelRow, "skill" | "rating" | "uncertainty" | "evidence">;

const byCourseOrder = (a: LevelRow, b: LevelRow) =>
  SKILLS.indexOf(a.skill) - SKILLS.indexOf(b.skill);

/** The rows a learner known only by the cached band reads as (see `backfillFromCache`). */
async function cachedRows(db: Db, userId: number): Promise<LevelRow[]> {
  const [settings] = await db
    .select({ cefrLevel: userSettings.cefrLevel })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  if (!settings?.cefrLevel) return [];
  const rating = bandCentre(settings.cefrLevel);
  return SKILLS.map((skill) => ({
    skill,
    rating,
    uncertainty: SEEDED_UNCERTAINTY.chosen,
    evidence: 0,
  }));
}

/** Every skill's level and the overall one; undefined for a learner with no level yet. */
export async function getLevels(db: Db, userId: number): Promise<Levels | undefined> {
  const stored = await listSkillLevels(db, userId);
  const rows = (stored.length > 0 ? stored : await cachedRows(db, userId)).sort(byCourseOrder);
  const level = overall(Object.fromEntries(rows.map((row) => [row.skill, row])));
  if (!level) return undefined;
  return {
    overall: asLevel(level),
    skills: Object.fromEntries(
      rows.map((row) => [row.skill, { ...asLevel(row), evidence: row.evidence }]),
    ),
  };
}

/** The overall level alone; undefined for a learner with no level yet. */
export async function getOverallLevel(db: Db, userId: number): Promise<Level | undefined> {
  return (await getLevels(db, userId))?.overall;
}
