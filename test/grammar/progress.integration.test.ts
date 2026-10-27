import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import {
  learningSessions,
  topicProgress,
  transferEvents,
  userSettings,
  users,
  xpEvents,
} from "../../src/db/schema";
import { TOPIC_MASTERED_XP } from "../../src/gamification";
import { type TopicMastered, topicEvents } from "../../src/grammar";
import { ERROR_FREE_MS } from "../../src/grammar/mastery";
import {
  recordTopicItem,
  recordTransfer,
  topicProgressMap,
  transferSummary,
} from "../../src/grammar/progress";
import { recordGrammarItem, recordTalkTurn, seedLevels } from "../../src/levels";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const DAY = 24 * 60 * 60 * 1000;
const TOPIC = "g015"; // B1.1
const OTHER = "g016";
const TYPES = ["multiple_choice", "gap_fill"] as const;
const TALK = { source: "talk", sessionId: null, messageId: null } as const;

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

  const row = async (topicId = TOPIC) => {
    const [found] = await database.db
      .select()
      .from(topicProgress)
      .where(and(eq(topicProgress.userId, userId), eq(topicProgress.topicId, topicId)));
    return found;
  };
  const events = async () =>
    database.db.select().from(transferEvents).where(eq(transferEvents.userId, userId));
  const masteryXp = async () =>
    database.db
      .select()
      .from(xpEvents)
      .where(and(eq(xpEvents.userId, userId), eq(xpEvents.source, "topic_mastered")));
  const ago = (days: number) => new Date(Date.now() - days * DAY);

  /** Right grammar sessions on `TOPIC`, `daysAgo` each, four items of two types apiece. */
  async function practise(...daysAgo: number[]) {
    for (const [index, days] of daysAgo.entries()) {
      for (let i = 0; i < 4; i++) {
        await recordTopicItem(
          database.db,
          userId,
          TOPIC,
          { type: TYPES[i % 2] ?? "gap_fill", score: 1, session: 1000 + index },
          new Date(ago(days).getTime() + i * 60_000),
        );
      }
    }
  }

  test("the first item creates the row as learning; an unknown topic records nothing", async () => {
    const item = { type: "gap_fill", score: 1, session: 1 };
    expect(await recordTopicItem(database.db, userId, "g999", item)).toBe(undefined);
    expect(await recordTopicItem(database.db, userId, null, item)).toBe(undefined);
    await recordTopicItem(database.db, userId, TOPIC, { ...item, score: 0 });
    expect(await row()).toMatchObject({
      status: "learning",
      accuracyByType: { gap_fill: 0 },
      sessionResults: [{ session: 1, scoreSum: 0, items: 1, types: ["gap_fill"] }],
      transferEvidence: 0,
      lastErrorAt: null,
      fsrs: null,
      methodHistory: [],
    });
    expect((await topicProgressMap(database.db, userId)).get(TOPIC)?.status).toBe("learning");
  });

  test("a graded quiz answer masters a practised topic, emits topic.mastered and pays once", async () => {
    await practise(10, 7);
    await recordTransfer(database.db, userId, TALK, { correct: [TOPIC, "g999"], errors: [] });
    await recordTransfer(database.db, userId, TALK, { correct: [TOPIC], errors: [] });
    expect((await row())?.transferEvidence).toBe(2);
    expect(await events()).toHaveLength(2);

    const seen: TopicMastered[] = [];
    const off = topicEvents.on("topic.mastered", (event) => {
      if (event.userId === userId) seen.push(event);
    });
    try {
      const item = { topic_id: TOPIC, difficulty: "B1" as const, type: "gap_fill" };
      await recordGrammarItem(database.db, userId, item, "correct", 2000);
      await recordGrammarItem(database.db, userId, item, "correct", 2000);
    } finally {
      off();
    }

    const stored = await row();
    expect(stored?.status).toBe("mastered");
    expect(stored?.sessionResults.at(-1)).toMatchObject({ session: 2000, items: 2 });
    expect(stored?.fsrs).not.toBeNull();
    expect(stored?.reviewDue?.getTime()).toBeGreaterThan(Date.now());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ topicId: TOPIC, first: true });
    const paid = await masteryXp();
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ amount: TOPIC_MASTERED_XP, meta: { topicId: TOPIC } });
  });

  test("a talk turn records its tags as transfer events and its correct use can master", async () => {
    const [session] = await database.db
      .insert(learningSessions)
      .values({ userId, kind: "talk" })
      .returning();
    await practise(10, 6, 2);
    await recordTransfer(database.db, userId, TALK, { correct: [TOPIC], errors: [] }, ago(1));
    expect((await row())?.status).toBe("learning");

    await recordTalkTurn(
      database.db,
      userId,
      "I have lived here since last spring and I am enjoy it.",
      [{ severity: "moderate", topic_id: OTHER }],
      { topicUses: [TOPIC], sessionId: session?.id ?? null, messageId: 42 },
    );
    expect((await row())?.status).toBe("mastered");
    expect(await masteryXp()).toHaveLength(1);
    expect((await row(OTHER))?.lastErrorAt).not.toBeNull();
    const turn = (await events()).filter((e) => e.messageId === 42);
    expect(turn.map((e) => [e.topicId, e.kind, e.source, e.sessionId])).toEqual(
      expect.arrayContaining([
        [OTHER, "error", "talk", session?.id],
        [TOPIC, "correct", "talk", session?.id],
      ]),
    );
    expect(turn).toHaveLength(2);
  });

  test("a topic both corrected and used in one turn counts as an error only", async () => {
    await recordTransfer(database.db, userId, TALK, {
      correct: [TOPIC, TOPIC],
      errors: [TOPIC, TOPIC, "g999"],
    });
    expect((await events()).map((e) => e.kind)).toEqual(["error"]);
    expect(await row()).toMatchObject({ transferEvidence: 0, status: "not_started" });
  });

  test("an error tagged in conversation turns a mastered topic shaky", async () => {
    await practise(10, 7, 3);
    await recordTransfer(database.db, userId, TALK, { correct: [TOPIC], errors: [] }, ago(2));
    await recordTransfer(database.db, userId, TALK, { correct: [TOPIC], errors: [] }, ago(1));
    expect((await row())?.status).toBe("mastered");
    await recordTalkTurn(database.db, userId, "Yesterday I have seen a very good film.", [
      { severity: "critical", topic_id: TOPIC },
    ]);
    expect(await row()).toMatchObject({ status: "shaky", masteredAt: null });
    expect((await row())?.firstMasteredAt).not.toBeNull();
  });

  test("a too-short talk turn records no transfer", async () => {
    await recordTalkTurn(database.db, userId, "Yes, I have.", [], { topicUses: [TOPIC] });
    expect(await row()).toBeUndefined();
    expect(await events()).toHaveLength(0);
  });

  test("the topic screen's summary: correct uses ever, errors within the window", async () => {
    const old = new Date(Date.now() - ERROR_FREE_MS - DAY);
    await recordTransfer(database.db, userId, TALK, { correct: [TOPIC], errors: [] }, old);
    await recordTransfer(database.db, userId, TALK, { correct: [TOPIC], errors: [] });
    await recordTransfer(database.db, userId, TALK, { correct: [], errors: [TOPIC] }, old);
    await recordTransfer(database.db, userId, TALK, { correct: [], errors: [TOPIC] }, ago(1));
    await recordTransfer(
      database.db,
      userId,
      { ...TALK, source: "writing" },
      { correct: [TOPIC], errors: [] },
    );
    expect(await transferSummary(database.db, userId, TOPIC)).toEqual({
      correct: { talk: 2, writing: 1 },
      recentErrors: { talk: 1 },
    });
    expect(await transferSummary(database.db, userId, OTHER)).toEqual({
      correct: {},
      recentErrors: {},
    });
  });

  test("a failed check sends it back to learning; mastering again pays nothing more", async () => {
    await practise(40, 37, 33);
    await recordTransfer(database.db, userId, TALK, { correct: [TOPIC], errors: [] }, ago(32));
    await recordTransfer(database.db, userId, TALK, { correct: [TOPIC], errors: [] }, ago(31));
    const mastered = await row();
    expect(mastered?.status).toBe("mastered");
    // The review is due well within the 31 days since.
    expect(mastered?.reviewDue?.getTime()).toBeLessThan(Date.now());

    await recordTopicItem(database.db, userId, TOPIC, { type: "gap_fill", score: 0, session: 9 });
    expect(await row()).toMatchObject({ status: "learning", checkScores: [] });
    expect(await masteryXp()).toHaveLength(0); // mastered through recordTransfer directly: no XP
  });
});
