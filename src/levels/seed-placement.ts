import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { putSkillLevels } from "../db/repositories/levels";
import { type CefrLevel, type Skill, userSettings } from "../db/schema";
import { bandOf, clampRating, type LevelState, MIN_UNCERTAINTY, overall, SKILLS } from "./model";

/** A skill's level as the full placement test measured it. */
export type PlacementLevel = LevelState & { evidence: number };

/**
 * A finished full placement test: every skill starts where the test measured it, with the
 * test's own uncertainty and evidence, replacing whatever the learner had, and the cache is set
 * to the overall band. Returns that band. One transaction, so a test is stored whole or not at all.
 */
export async function seedPlacementLevels(
  db: Db,
  userId: number,
  levels: Record<Skill, PlacementLevel>,
  now: Date = new Date(),
): Promise<CefrLevel> {
  const rows = SKILLS.map((skill) => ({
    skill,
    rating: clampRating(levels[skill].rating),
    uncertainty: Math.max(MIN_UNCERTAINTY, levels[skill].uncertainty),
    evidence: levels[skill].evidence,
  }));
  const level = overall(Object.fromEntries(rows.map((row) => [row.skill, row])));
  if (!level) throw new Error("placement levels without a skill");
  const band = bandOf(level.rating);
  await db.transaction(async (tx) => {
    await putSkillLevels(tx, userId, rows, now);
    await tx.update(userSettings).set({ cefrLevel: band }).where(eq(userSettings.userId, userId));
  });
  return band;
}
