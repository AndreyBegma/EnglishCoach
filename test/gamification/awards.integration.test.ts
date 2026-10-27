import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { getUserXp } from "../../src/db/repositories/xp";
import { userSettings, users, xpEvents } from "../../src/db/schema";
import { domainEvents } from "../../src/events/domain-events";
import {
  awardCardRating,
  awardGoalMet,
  awardGrammarItem,
  awardTopicMastered,
  awardXp,
  BASE_XP,
  xpEvents as bus,
  DAILY_GOAL_XP,
  loadProfile,
  streakXp,
  TOPIC_MASTERED_XP,
  type XpAwarded,
} from "../../src/gamification";
import { bandCentre, recordTalkTurn, seedLevels } from "../../src/levels";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const B1 = bandCentre("B1");
const NOW = new Date("2026-10-27T10:00:00Z");

describe.skipIf(!testServerUrl)("XP ledger in the database", () => {
  let database: Database;
  let userId: number;
  let telegramId = 940_000;

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

  const ledger = () =>
    database.db.select().from(xpEvents).where(eq(xpEvents.userId, userId)).orderBy(xpEvents.id);

  test("an award lands in the ledger and the cached total, and emits xp.awarded", async () => {
    const seen: XpAwarded[] = [];
    const off = bus.on("xp.awarded", (event) => {
      if (event.userId === userId) seen.push(event);
    });
    try {
      await awardXp(database.db, userId, { source: "daily_goal", amount: 60 }, NOW);
      await awardXp(database.db, userId, { source: "daily_goal", amount: 50 }, NOW);
    } finally {
      off();
    }
    expect((await ledger()).map((row) => row.amount)).toEqual([60, 50]);
    expect(await getUserXp(database.db, userId)).toMatchObject({ total: 110, level: 2 });
    expect(
      seen.map(({ total, level, previousLevel }) => ({ total, level, previousLevel })),
    ).toEqual([
      { total: 60, level: 1, previousLevel: 1 },
      { total: 110, level: 2, previousLevel: 1 },
    ]);
  });

  test("a zero award writes nothing", async () => {
    expect(await awardXp(database.db, userId, { source: "review", amount: 0 })).toBeUndefined();
    expect(await ledger()).toHaveLength(0);
    expect(await getUserXp(database.db, userId)).toBeUndefined();
  });

  test("a failing listener never fails the award", async () => {
    const off = bus.on("xp.awarded", () => {
      throw new Error("boom");
    });
    try {
      await awardXp(database.db, userId, { source: "review", amount: 3 });
    } finally {
      off();
    }
    expect(await ledger()).toHaveLength(1);
  });

  test("correct grammar answers alone never pay the mastery bonus", async () => {
    for (let i = 0; i < 10; i++) {
      await awardGrammarItem(database.db, userId, {
        topicId: "g010",
        verdict: "correct",
        score: 1,
        itemLevel: B1,
        rating: B1,
      });
    }
    const rows = await ledger();
    expect(rows.filter((row) => row.source === "grammar_item")).toHaveLength(10);
    expect(rows.filter((row) => row.source === "topic_mastered")).toHaveLength(0);
  });

  test("a topic's mastery bonus is paid once, also after one paid under the old rule", async () => {
    const master = (topicId: string) =>
      awardTopicMastered(database.db, userId, { topicId, itemLevel: B1, rating: B1 });
    await master("g010");
    await master("g010");
    await awardXp(database.db, userId, {
      source: "topic_mastered",
      amount: TOPIC_MASTERED_XP,
      meta: { topicId: "g020" },
    });
    await master("g020");
    const mastered = (await ledger()).filter((row) => row.source === "topic_mastered");
    expect(mastered.map((row) => row.meta)).toEqual([{ topicId: "g010" }, { topicId: "g020" }]);
    expect(mastered[0]?.amount).toBe(TOPIC_MASTERED_XP);
  });

  test("anti-farming: a topic far below the learner earns no mastery bonus", async () => {
    await awardTopicMastered(database.db, userId, {
      topicId: "g001",
      itemLevel: bandCentre("A1"),
      rating: bandCentre("C1"),
    });
    expect(await ledger()).toHaveLength(0);
  });

  test("anti-farming: a far-below grammar item earns nothing", async () => {
    for (let i = 0; i < 5; i++) {
      await awardGrammarItem(database.db, userId, {
        topicId: "g001",
        verdict: "correct",
        score: 1,
        itemLevel: bandCentre("A1"),
        rating: bandCentre("C1"),
      });
    }
    expect(await ledger()).toHaveLength(0);
  });

  test("a word is learned once, when mastered; other passes are reviews; a lapse earns nothing", async () => {
    const learned: number[] = [];
    const off = domainEvents.on("card.learned", (event) => {
      learned.push(event.cardId);
    });
    const rate = (mastered: boolean, score: number) =>
      awardCardRating(database.db, userId, {
        cardId: 77,
        learned: mastered,
        score,
        itemLevel: B1,
        rating: B1,
      });
    await rate(false, 0);
    await rate(false, 1);
    await rate(true, 1);
    await rate(true, 1);
    await rate(false, 0);
    off();
    expect((await ledger()).map(({ source, amount }) => ({ source, amount }))).toEqual([
      { source: "review", amount: BASE_XP.review },
      { source: "word_learned", amount: BASE_XP.word_learned },
      { source: "review", amount: BASE_XP.review },
    ]);
    expect(learned).toEqual([77]);
  });

  test("the goal bonus, plus the streak bonus from day 2", async () => {
    await awardGoalMet(database.db, userId, { date: "2026-10-26", streak: 1 });
    await awardGoalMet(database.db, userId, { date: "2026-10-27", streak: 2 });
    expect((await ledger()).map(({ source, amount }) => ({ source, amount }))).toEqual([
      { source: "daily_goal", amount: DAILY_GOAL_XP },
      { source: "daily_goal", amount: DAILY_GOAL_XP },
      { source: "streak", amount: streakXp(2) },
    ]);
  });

  test("a talk turn through the level API earns XP; a short one earns none", async () => {
    await seedLevels(database.db, userId, "B1", "chosen", NOW);
    await recordTalkTurn(database.db, userId, "ok", []);
    await recordTalkTurn(database.db, userId, "I really enjoyed the film last night", []);
    expect((await ledger()).map(({ source, amount }) => ({ source, amount }))).toEqual([
      { source: "talk_turn", amount: BASE_XP.talk_turn },
    ]);
  });

  test("the profile reads the total, level, skills and totals", async () => {
    await seedLevels(database.db, userId, "B2", "chosen", NOW);
    await awardXp(database.db, userId, { source: "daily_goal", amount: 250 }, NOW);
    const profile = await loadProfile(database.db, userId, { timezone: "UTC" }, NOW);
    expect(profile.xp).toBe(250);
    expect(profile.level).toEqual({ level: 3, into: 35, needed: 132 });
    expect(profile.cefr).toBe("B2.5");
    expect(profile.skills).toHaveLength(6);
    expect(profile.skills.every((skill) => !skill.practised)).toBe(true);
    expect(profile.totals).toEqual({
      wordsLearned: 0,
      reviews: 0,
      grammarAnswered: 0,
      goalDays: 0,
    });
  });
});
