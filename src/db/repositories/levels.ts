import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type Skill, type SkillLevelRow, skillLevels } from "../schema";

/** A transaction handle or the database: these run inside the level model's transactions. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

export async function listSkillLevels(db: Tx, userId: number): Promise<SkillLevelRow[]> {
  return db.select().from(skillLevels).where(eq(skillLevels.userId, userId));
}

/** One skill's row, locked until the transaction ends so concurrent items queue. */
export async function lockSkillLevel(
  tx: Tx,
  userId: number,
  skill: Skill,
): Promise<SkillLevelRow | undefined> {
  const [row] = await tx
    .select()
    .from(skillLevels)
    .where(and(eq(skillLevels.userId, userId), eq(skillLevels.skill, skill)))
    .for("update");
  return row;
}

export type SkillLevelWrite = Pick<SkillLevelRow, "skill" | "rating" | "uncertainty" | "evidence">;

/** Inserts the given skills' levels where the learner has none; existing rows stay. */
export async function addMissingSkillLevels(
  tx: Tx,
  userId: number,
  levels: SkillLevelWrite[],
  now: Date,
): Promise<void> {
  if (levels.length === 0) return;
  await tx
    .insert(skillLevels)
    .values(levels.map((level) => ({ ...level, userId, updatedAt: now })))
    .onConflictDoNothing();
}

/** Inserts or replaces the given skills' levels. */
export async function putSkillLevels(
  tx: Tx,
  userId: number,
  levels: SkillLevelWrite[],
  now: Date,
): Promise<void> {
  if (levels.length === 0) return;
  await tx
    .insert(skillLevels)
    .values(levels.map((level) => ({ ...level, userId, updatedAt: now })))
    .onConflictDoUpdate({
      target: [skillLevels.userId, skillLevels.skill],
      set: {
        rating: sql`excluded.rating`,
        uncertainty: sql`excluded.uncertainty`,
        evidence: sql`excluded.evidence`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
