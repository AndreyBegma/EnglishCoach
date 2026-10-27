import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { getSettings } from "../../src/db/repositories/users";
import { skillLevels, userSettings, users } from "../../src/db/schema";
import {
  bandCentre,
  getLevels,
  ITEM_EXPECTED,
  PRIOR,
  recordGradedItem,
  recordPlacement,
  recordTalkTurn,
  SEEDED_UNCERTAINTY,
  SKILLS,
  seedLevels,
} from "../../src/levels";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const NOW = new Date("2026-10-27T10:00:00Z");

describe.skipIf(!testServerUrl)("skill levels in the database", () => {
  let database: Database;
  let userId: number;
  let telegramId = 930_000;

  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  beforeEach(async () => {
    const [user] = await database.db
      .insert(users)
      .values({ telegramId: ++telegramId, isAllowed: true })
      .returning();
    userId = user?.id ?? 0;
    await database.db.insert(userSettings).values({ userId });
  });

  const cache = async () => (await getSettings(database.db, userId))?.cefrLevel;

  test("seeding sets every skill and the cache", async () => {
    await seedLevels(database.db, userId, "B2", "chosen", NOW);
    const levels = await getLevels(database.db, userId);
    expect(levels?.overall.label).toBe("B2.5");
    for (const skill of SKILLS) {
      expect(levels?.skills[skill]).toMatchObject({
        rating: bandCentre("B2"),
        uncertainty: SEEDED_UNCERTAINTY.chosen,
        evidence: 0,
      });
    }
    expect(await cache()).toBe("B2");
  });

  test("a graded item moves its skill only and counts as evidence", async () => {
    await seedLevels(database.db, userId, "B1", "chosen", NOW);
    const after = await recordGradedItem(database.db, userId, "grammar", "B2", 1, { now: NOW });
    expect(after.rating).toBeGreaterThan(bandCentre("B1"));
    expect(after.uncertainty).toBeLessThan(SEEDED_UNCERTAINTY.chosen);
    const levels = await getLevels(database.db, userId);
    expect(levels?.skills.grammar?.evidence).toBe(1);
    expect(levels?.skills.vocabulary?.rating).toBe(bandCentre("B1"));
  });

  test("the cache follows the overall band once the learner has a level", async () => {
    await seedLevels(database.db, userId, "A2", "chosen", NOW);
    for (const skill of SKILLS) {
      for (let i = 0; i < 30; i++) {
        await recordGradedItem(database.db, userId, skill, "B2", 1, { now: NOW });
      }
    }
    expect(await cache()).not.toBe("A2");
    const levels = await getLevels(database.db, userId);
    expect(await cache()).toBe(levels?.overall.band);
  });

  test("a learner with no level gets ratings but no cache: onboarding still runs", async () => {
    const level = await recordGradedItem(database.db, userId, "grammar", "B1", 1, { now: NOW });
    expect(level.uncertainty).toBeLessThan(PRIOR.uncertainty);
    expect(await cache()).toBeNull();
  });

  test("a learner known only by the cached band starts there, and the cache holds", async () => {
    await database.db
      .update(userSettings)
      .set({ cefrLevel: "A2" })
      .where(eq(userSettings.userId, userId));
    expect((await getLevels(database.db, userId))?.overall.label).toBe("A2.5");

    await recordGradedItem(database.db, userId, "vocabulary", "A2", 1, {
      expected: ITEM_EXPECTED.card,
      now: NOW,
    });
    const levels = await getLevels(database.db, userId);
    expect(levels?.skills.vocabulary?.evidence).toBe(1);
    expect(levels?.skills.grammar).toMatchObject({ rating: bandCentre("A2"), evidence: 0 });
    expect(await cache()).toBe("A2");
  });

  test("placement seeds every skill and replays each item into its own skill", async () => {
    await recordPlacement(database.db, userId, "B1", [
      { level: "B2", skill: "grammar", correct: true },
      { level: "A2", skill: "vocabulary", correct: false },
    ]);
    const levels = await getLevels(database.db, userId);
    expect(levels?.skills.grammar?.rating).toBeGreaterThan(bandCentre("B1"));
    expect(levels?.skills.vocabulary?.rating).toBeLessThan(bandCentre("B1"));
    expect(levels?.skills.speaking).toMatchObject({ rating: bandCentre("B1"), evidence: 0 });
    expect(await cache()).toBe("B1");
  });

  test("a talk turn rates writing; a short one is not evidence", async () => {
    await seedLevels(database.db, userId, "B1", "chosen", NOW);
    await recordTalkTurn(database.db, userId, "ok thanks", []);
    expect((await getLevels(database.db, userId))?.skills.writing?.evidence).toBe(0);
    await recordTalkTurn(database.db, userId, "I have went to the shop yesterday evening", [
      { severity: "critical" },
    ]);
    const writing = (await getLevels(database.db, userId))?.skills.writing;
    expect(writing?.evidence).toBe(1);
    expect(writing?.rating).toBeLessThan(bandCentre("B1"));
  });

  test("an item a learner of its level is meant to pass moves less on a pass", async () => {
    await seedLevels(database.db, userId, "B1", "chosen", NOW);
    const fresh = await recordGradedItem(database.db, userId, "reading", "B1", 1, { now: NOW });
    const review = await recordGradedItem(database.db, userId, "listening", "B1", 1, {
      expected: ITEM_EXPECTED.card,
      now: NOW,
    });
    expect(review.rating - bandCentre("B1")).toBeLessThan(fresh.rating - bandCentre("B1"));
  });

  test("the migration gives existing learners their level in every skill", async () => {
    const file = await Bun.file(
      join(import.meta.dir, "../../drizzle/0010_skill_levels.sql"),
    ).text();
    const backfill = file.split("--> statement-breakpoint").at(-1) ?? "";
    expect(backfill).toContain("INSERT INTO");
    await database.db
      .update(userSettings)
      .set({ cefrLevel: "C1" })
      .where(eq(userSettings.userId, userId));
    await database.db.delete(skillLevels);
    await database.db.execute(sql.raw(backfill));

    const levels = await getLevels(database.db, userId);
    for (const skill of SKILLS) {
      expect(levels?.skills[skill]).toMatchObject({
        rating: bandCentre("C1"),
        uncertainty: SEEDED_UNCERTAINTY.chosen,
        evidence: 0,
      });
    }
    expect(levels?.overall.label).toBe("C1.5");
    // Learners without a level get no rows.
    const unlevelled = await database.db
      .select({ userId: userSettings.userId })
      .from(userSettings)
      .where(isNull(userSettings.cefrLevel));
    expect(unlevelled.length).toBeGreaterThan(0);
    const rows = await database.db.select().from(skillLevels);
    const levelled = new Set(rows.map((row) => row.userId));
    for (const { userId: id } of unlevelled) expect(levelled.has(id)).toBe(false);
  });
});
