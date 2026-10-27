import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { getCounters, listUnlocks, markNotified } from "../../src/db/repositories/achievements";
import { getUserXp } from "../../src/db/repositories/xp";
import { userSettings, users, xpEvents } from "../../src/db/schema";
import { DomainEvents } from "../../src/events/domain-events";
import { awardXp, XpEvents } from "../../src/gamification";
import {
  AchievementEngine,
  achievementCatalogue,
  pendingUnlocks,
  RUN,
} from "../../src/gamification/achievements";
import { topicById } from "../../src/grammar/topics";
import { createLogger } from "../../src/log";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const log = createLogger({ level: "error" });
const NOW = new Date("2026-10-27T10:00:00Z");

describe.skipIf(!testServerUrl)("achievements in the database", () => {
  let database: Database;
  let engine: AchievementEngine;
  let userId: number;
  let telegramId = 950_000;

  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    engine = new AchievementEngine({ db: database.db, log, catalogue: achievementCatalogue() });
  });
  afterAll(() => database.close());

  beforeEach(async () => {
    const [user] = await database.db
      .insert(users)
      .values({ telegramId: ++telegramId, isAllowed: true })
      .returning();
    userId = user?.id ?? 0;
    await database.db.insert(userSettings).values({ userId, timezone: "UTC" });
  });

  const unlocked = async () =>
    (await listUnlocks(database.db, userId)).map((row) => row.achievementId).sort();
  const achievementXp = () =>
    database.db
      .select()
      .from(xpEvents)
      .where(and(eq(xpEvents.userId, userId), eq(xpEvents.source, "achievement")));

  test("an unlock happens once and pays its XP once, however often it is reached", async () => {
    const first = await engine.record(userId, [{ metric: "words_learned", op: "add", by: 1 }], NOW);
    expect(first.map((entry) => entry.id)).toEqual(["words_learned_1"]);
    // Reached again (a replayed event, a later count): nothing new, no second payment.
    expect(
      await engine.record(userId, [{ metric: "words_learned", op: "max", value: 1 }], NOW),
    ).toEqual([]);
    await engine.onCardLearned({ userId, cardId: 1, at: NOW });

    expect(await unlocked()).toEqual(["words_learned_1"]);
    const paid = await achievementXp();
    expect(paid.map((row) => [row.amount, row.meta])).toEqual([
      [10, { achievementId: "words_learned_1" }],
    ]);
    expect((await getUserXp(database.db, userId))?.total).toBe(10);
    expect((await getCounters(database.db, userId)).get("words_learned")).toBe(2);
  });

  test("concurrent events unlock each entry once", async () => {
    await Promise.all(
      Array.from({ length: 6 }, () =>
        engine.record(userId, [{ metric: "day_streak", op: "max", value: 3 }], NOW),
      ),
    );
    expect(await unlocked()).toEqual(["day_streak_2", "day_streak_3"]);
    expect(await achievementXp()).toHaveLength(2);
  });

  test("one event can unlock several steps of a series at once", async () => {
    const entries = await engine.record(
      userId,
      [{ metric: "words_learned", op: "set", value: 60 }],
      NOW,
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      "words_learned_1",
      "words_learned_10",
      "words_learned_25",
      "words_learned_50",
    ]);
    expect((await getUserXp(database.db, userId))?.total).toBe(10 + 10 + 10 + 25);
  });

  test("a topic mastered twice counts once", async () => {
    await engine.onTopicMastered({ userId, topicId: "g001", at: NOW });
    await engine.onTopicMastered({ userId, topicId: "g001", at: NOW });
    await engine.onTopicMastered({ userId, topicId: "nope", at: NOW });
    const band = topicById("g001")?.band.toLowerCase();
    expect(await unlocked()).toEqual([
      "topic_g001",
      "topics_mastered_1",
      `topics_mastered_${band}_1`,
    ]);
    const counters = await getCounters(database.db, userId);
    expect(counters.get("topics_mastered")).toBe(1);
    expect(counters.get(`topics_mastered_${band}`)).toBe(1);
  });

  test("a wrong answer breaks the run but not the best run", async () => {
    const answer = (verdict: string) =>
      engine.onGrammarAnswered({ userId, topicId: "g001", verdict, score: 1, at: NOW });
    for (let i = 0; i < 3; i++) await answer("correct");
    await answer("wrong");
    await answer("correct");
    const counters = await getCounters(database.db, userId);
    expect(counters.get("grammar_run")).toBe(3);
    expect(counters.get(RUN.grammar)).toBe(1);
    expect(counters.get("grammar_answers")).toBe(5);
    expect(counters.get("grammar_correct")).toBe(4);
    expect(counters.get(`grammar_correct_${topicById("g001")?.band.toLowerCase()}`)).toBe(4);
    expect(await unlocked()).toContain("grammar_run_3");
  });

  test("a session of five clean answers is perfect; one with a miss is not", async () => {
    const ended = (sessionId: number) =>
      engine.onSessionEnded({
        userId,
        sessionId,
        kind: "grammar",
        status: "finished",
        startedAt: NOW,
        at: NOW,
      });
    for (let i = 0; i < 5; i++) {
      await engine.onGrammarAnswered({
        userId,
        topicId: null,
        verdict: "correct",
        score: 1,
        at: NOW,
      });
    }
    await ended(1);
    for (let i = 0; i < 5; i++) {
      await engine.onCardRated({
        userId,
        cardId: i,
        score: i === 2 ? 0 : 1,
        learned: false,
        at: NOW,
      });
    }
    await ended(2);
    const counters = await getCounters(database.db, userId);
    expect(counters.get("perfect_sessions")).toBe(1);
    expect(counters.get("sessions_grammar")).toBe(2);
    expect(counters.get("sessions_finished")).toBe(2);
    expect(counters.get("reviews")).toBe(4);
    expect(counters.get("reviews_perfect")).toBe(4);
    expect(counters.get(RUN.items)).toBe(0);
  });

  test("a cancelled session counts for nothing but still closes the item run", async () => {
    await engine.onGrammarAnswered({
      userId,
      topicId: null,
      verdict: "correct",
      score: 1,
      at: NOW,
    });
    await engine.onSessionEnded({
      userId,
      sessionId: 1,
      kind: "talk",
      status: "cancelled",
      startedAt: NOW,
      at: NOW,
    });
    const counters = await getCounters(database.db, userId);
    expect(counters.get("sessions_finished")).toBeUndefined();
    expect(counters.get(RUN.items)).toBe(0);
  });

  test("time of day, weekend and season come from the learner's own clock", async () => {
    await database.db
      .update(userSettings)
      .set({ timezone: "Asia/Tokyo" })
      .where(eq(userSettings.userId, userId));
    // 2026-10-30 17:30 UTC is Saturday 31 October, 02:30 in Tokyo.
    await engine.onSessionEnded({
      userId,
      sessionId: 1,
      kind: "review",
      status: "finished",
      startedAt: NOW,
      at: new Date("2026-10-30T17:30:00Z"),
    });
    const ids = await unlocked();
    expect(ids).toContain("season_halloween_1");
    expect(ids).toContain("sessions_weekend_1");
    expect(ids).toContain("secret_deep_night");
    expect(ids).not.toContain("sessions_night_1");
  });

  test("listens on the buses: a met goal unlocks through xp.awarded", async () => {
    const xp = new XpEvents(log);
    const events = new DomainEvents(log);
    const stop = engine.start(xp, events);
    try {
      const awarded = await awardXp(database.db, userId, { source: "daily_goal", amount: 30 }, NOW);
      if (awarded) await xp.emit(awarded);
      await events.emit("talk.correction_fixed", { userId, at: NOW });
    } finally {
      stop();
    }
    const ids = await unlocked();
    expect(ids).toContain("goal_days_1");
    expect(ids).toContain("corrections_fixed_1");
  });

  test("new unlocks wait for the hub, then are marked shown", async () => {
    await engine.record(userId, [{ metric: "sessions_finished", op: "add", by: 1 }], NOW);
    const pending = await pendingUnlocks(database.db, userId);
    expect(pending.ids).toEqual(["sessions_finished_1"]);
    await markNotified(database.db, userId, pending.ids, NOW);
    expect((await pendingUnlocks(database.db, userId)).ids).toEqual([]);
  });
});
