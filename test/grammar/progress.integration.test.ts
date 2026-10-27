import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { topicProgress, userSettings, users, xpEvents } from "../../src/db/schema";
import { TOPIC_MASTERED_XP } from "../../src/gamification";
import { type TopicMastered, topicEvents } from "../../src/grammar";
import { MASTERY_WINDOW } from "../../src/grammar/mastery";
import { recordTopicItem, recordTopicUses, topicProgressMap } from "../../src/grammar/progress";
import { recordGrammarItem, recordTalkTurn, seedLevels } from "../../src/levels";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const DAY = 24 * 60 * 60 * 1000;
const TOPIC = "g015"; // B1.1
const TYPES = ["multiple_choice", "gap_fill"] as const;

describe.skipIf(!testServerUrl)("topic mastery in the database", () => {
  let database: Database;
  let userId: number;
  let telegramId = 960_000;

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
    await seedLevels(database.db, userId, "B1", "chosen");
  });

  const row = async () => {
    const [found] = await database.db
      .select()
      .from(topicProgress)
      .where(and(eq(topicProgress.userId, userId), eq(topicProgress.topicId, TOPIC)));
    return found;
  };
  const masteryXp = async () =>
    database.db
      .select()
      .from(xpEvents)
      .where(and(eq(xpEvents.userId, userId), eq(xpEvents.source, "topic_mastered")));

  /** A full right window `daysAgo` days back. */
  async function rightWindow(daysAgo: number) {
    const start = Date.now() - daysAgo * DAY;
    for (let i = 0; i < MASTERY_WINDOW; i++) {
      await recordTopicItem(
        database.db,
        userId,
        TOPIC,
        { type: TYPES[i % 2] ?? "gap_fill", score: 1 },
        new Date(start + i * 60_000),
      );
    }
  }

  test("the first item creates the row as learning; an unknown topic records nothing", async () => {
    expect(await recordTopicItem(database.db, userId, "g999", { type: "gap_fill", score: 1 })).toBe(
      undefined,
    );
    expect(await recordTopicItem(database.db, userId, null, { type: "gap_fill", score: 1 })).toBe(
      undefined,
    );
    await recordTopicItem(database.db, userId, TOPIC, { type: "gap_fill", score: 0 });
    expect(await row()).toMatchObject({
      status: "learning",
      accuracyByType: { gap_fill: 0 },
      transferEvidence: 0,
      fsrs: null,
      methodHistory: [],
    });
    expect((await topicProgressMap(database.db, userId)).get(TOPIC)?.status).toBe("learning");
  });

  test("a graded quiz answer masters a confirmed topic, emits topic.mastered and pays once", async () => {
    await rightWindow(4);
    await recordTopicUses(database.db, userId, [TOPIC, "g999"], new Date(Date.now() - 3 * DAY));
    expect((await row())?.transferEvidence).toBe(1);

    const seen: TopicMastered[] = [];
    const off = topicEvents.on("topic.mastered", (event) => {
      if (event.userId === userId) seen.push(event);
    });
    try {
      const item = { topic_id: TOPIC, difficulty: "B1" as const, type: "gap_fill" };
      await recordGrammarItem(database.db, userId, item, "correct");
      await recordGrammarItem(database.db, userId, item, "correct");
    } finally {
      off();
    }

    const stored = await row();
    expect(stored?.status).toBe("mastered");
    expect(stored?.fsrs).not.toBeNull();
    expect(stored?.reviewDue?.getTime()).toBeGreaterThan(Date.now());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ topicId: TOPIC, first: true });
    const paid = await masteryXp();
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ amount: TOPIC_MASTERED_XP, meta: { topicId: TOPIC } });
  });

  test("a talk turn's correct use can be the step that masters the topic", async () => {
    await rightWindow(5);
    // Confirmed on day -1, but no transfer yet.
    await recordTopicItem(
      database.db,
      userId,
      TOPIC,
      { type: "gap_fill", score: 1 },
      new Date(Date.now() - DAY),
    );
    expect((await row())?.status).toBe("learning");
    await recordTalkTurn(database.db, userId, "I have lived here since last spring.", [], [TOPIC]);
    expect((await row())?.status).toBe("mastered");
    expect(await masteryXp()).toHaveLength(1);
  });

  test("a too-short talk turn records no transfer", async () => {
    await recordTalkTurn(database.db, userId, "Yes, I have.", [], [TOPIC]);
    expect(await row()).toBeUndefined();
  });

  test("a failed check sends it back to learning; mastering again pays nothing more", async () => {
    await rightWindow(30);
    await recordTopicUses(database.db, userId, [TOPIC], new Date(Date.now() - 29 * DAY));
    await recordTopicItem(
      database.db,
      userId,
      TOPIC,
      { type: "gap_fill", score: 1 },
      new Date(Date.now() - 26 * DAY),
    );
    const mastered = await row();
    expect(mastered?.status).toBe("mastered");
    // The review is due well within the 26 days since.
    expect(mastered?.reviewDue?.getTime()).toBeLessThan(Date.now());

    await recordTopicItem(database.db, userId, TOPIC, { type: "gap_fill", score: 0 });
    expect(await row()).toMatchObject({ status: "learning", checkScores: [] });
    expect(await masteryXp()).toHaveLength(0); // mastered by recordTopicItem directly: no XP path
  });
});
