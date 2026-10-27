import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import { listTopicProgress } from "../../src/db/repositories/topic-progress";
import { userSettings, users } from "../../src/db/schema";
import { recordTopicItem } from "../../src/grammar/progress";
import { topicProgressWriter } from "../../src/placement/topic-writer";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const AT = new Date("2026-10-27T12:00:00Z");

describe.skipIf(!testServerUrl)("placement topic flags into topic progress", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  let telegramId = 945_000;
  let userId = 0;
  beforeEach(async () => {
    const [user] = await database.db
      .insert(users)
      .values({ telegramId: ++telegramId, isAllowed: true })
      .returning();
    userId = user?.id ?? 0;
    await database.db.insert(userSettings).values({ userId });
  });

  const rows = async () =>
    new Map((await listTopicProgress(database.db, userId)).map((row) => [row.topicId, row]));

  test("mastered topics are placed on FSRS without earning; unknown ones get no row", async () => {
    await topicProgressWriter(database.db, () => AT).write(userId, [
      { topicId: "g001", status: "mastered" },
      { topicId: "g002", status: "unknown" },
    ]);
    const stored = await rows();
    expect(stored.has("g002")).toBe(false);
    const placed = stored.get("g001");
    expect(placed).toMatchObject({ status: "mastered", masteredAt: AT, firstMasteredAt: null });
    expect(placed?.fsrs).not.toBeNull();
    expect(placed?.reviewDue?.getTime()).toBeGreaterThan(AT.getTime());
  });

  test("a topic the learner has practised keeps its own progress", async () => {
    await recordTopicItem(database.db, userId, "g003", { type: "gap_fill", score: 0 }, AT);
    await topicProgressWriter(database.db, () => AT).write(userId, [
      { topicId: "g003", status: "mastered" },
    ]);
    expect((await rows()).get("g003")).toMatchObject({ status: "learning", fsrs: null });
  });
});
