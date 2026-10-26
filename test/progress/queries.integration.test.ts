import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import { cards, dailyStats, mistakes, userSettings, users } from "../../src/db/schema";
import { loadProgress } from "../../src/progress/queries";
import { streakDays } from "../../src/progress/streak";
import { createTestDatabase, testServerUrl } from "../db/test-database";

// Europe/Kyiv is UTC+2 until 2026-03-29, so 22:30Z on the 15th is already 00:30 on the 16th there.
const TZ = "Europe/Kyiv";
const NOW = new Date("2026-03-15T22:30:00Z");

describe.skipIf(!testServerUrl)("progress aggregates on seeded data", () => {
  let database: Database;
  let userId: number;
  let otherId: number;

  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    const { db } = database;
    const [user, other] = await db
      .insert(users)
      .values([
        { telegramId: 910_001, isAllowed: true },
        { telegramId: 910_002, isAllowed: true },
      ])
      .returning();
    userId = user?.id ?? 0;
    otherId = other?.id ?? 0;
    await db.insert(userSettings).values([
      { userId, cefrLevel: "B1", wordsPerDay: 5, timezone: TZ },
      { userId: otherId, timezone: TZ },
    ]);

    const day = (
      date: string,
      goalMet: boolean,
      newWords: number,
      reviews: number,
      grammarAnswered = 0,
      grammarCorrect = 0,
    ) => ({ userId, date, goalMet, newWords, reviews, grammarAnswered, grammarCorrect });
    await db.insert(dailyStats).values([
      day("2026-02-10", false, 0, 0, 100, 100), // older than 30 days
      day("2026-03-01", true, 5, 0, 10, 5),
      day("2026-03-02", true, 5, 0),
      day("2026-03-03", true, 5, 0),
      day("2026-03-04", true, 5, 0),
      day("2026-03-05", true, 5, 0),
      day("2026-03-06", true, 5, 0),
      day("2026-03-12", true, 5, 10, 4, 3),
      day("2026-03-13", true, 5, 0),
      day("2026-03-14", true, 5, 5),
      day("2026-03-15", true, 5, 0, 6, 6),
      day("2026-03-16", false, 3, 7, 5, 4),
      // Another learner's goal days must not leak in.
      { ...day("2026-03-16", true, 9, 9, 9, 9), userId: otherId },
    ]);

    const card = (
      itemType: "word" | "user_word" | "grammar_pattern",
      state: number,
      reps: number,
      due: string,
      front: string,
      owner = userId,
    ) => ({
      userId: owner,
      itemType,
      front,
      due: new Date(due),
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps,
      lapses: 0,
      state,
    });
    // Local end of 2026-03-16 in Kyiv is 22:00Z.
    await db.insert(cards).values([
      card("word", 0, 0, "2026-03-10T00:00:00Z", "pending"), // new, not reviewable
      card("word", 1, 1, "2026-03-16T10:00:00Z", "learning"), // due today
      card("word", 2, 5, "2026-03-16T21:59:00Z", "last-minute"), // due today
      card("word", 2, 3, "2026-03-16T22:00:00Z", "first-minute"), // due tomorrow
      card("user_word", 3, 2, "2026-03-17T21:59:00Z", "relearning"), // due tomorrow
      card("grammar_pattern", 0, 0, "2026-03-18T10:00:00Z", "pattern"), // new, later
      card("word", 2, 4, "2026-03-01T00:00:00Z", "overdue"), // due today
      card("word", 2, 9, "2026-03-16T08:00:00Z", "someone else", otherId),
    ]);

    const mistake = (pattern: string, count: number, lastSeen: string, owner = userId) => ({
      userId: owner,
      category: "grammar" as const,
      pattern,
      exampleWrong: "wrong",
      exampleRight: "right",
      explanation: "why",
      count,
      lastSeenAt: new Date(lastSeen),
    });
    await db
      .insert(mistakes)
      .values([
        mistake("articles", 5, "2026-03-01T00:00:00Z"),
        mistake("tenses", 4, "2026-03-02T00:00:00Z"),
        mistake("prepositions", 4, "2026-03-10T00:00:00Z"),
        mistake("modals", 2, "2026-03-03T00:00:00Z"),
        mistake("gerunds", 1, "2026-03-04T00:00:00Z"),
        mistake("passive", 1, "2026-03-01T00:00:00Z"),
        mistake("other learner", 50, "2026-03-01T00:00:00Z", otherId),
      ]);
  });
  afterAll(() => database.close());

  test("every block of the Progress screen", async () => {
    const data = await loadProgress(
      database.db,
      userId,
      { cefrLevel: "B1", wordsPerDay: 5, timezone: TZ },
      NOW,
    );
    expect(data.level).toBe("B1");
    // Today is the 16th in Kyiv; the run 12-15 ended yesterday, the older run 01-06 is the best.
    expect(data.streak).toEqual({ current: 4, best: 6 });
    expect(data.today).toEqual({ newWords: 3, reviews: 7, goalMet: false });
    expect(data.cards).toEqual({
      new: 2,
      learning: 2,
      review: 3,
      dueToday: 3,
      dueTomorrow: 2,
      wordsLearned: 5,
    });
    expect(data.activity).toEqual([0, 0, 19, 5, 10, 11, 15]);
    expect(data.grammar).toEqual({ answered7: 15, correct7: 13, answered30: 25, correct30: 18 });
    expect(data.weak.map((m) => [m.pattern, m.count])).toEqual([
      ["articles", 5],
      ["prepositions", 4], // same count as tenses, seen more recently
      ["tenses", 4],
      ["modals", 2],
      ["gerunds", 1], // ties on count with passive, seen more recently; passive is cut off
    ]);
  });

  test("a learner with nothing recorded gets zeros", async () => {
    const [blank] = await database.db
      .insert(users)
      .values({ telegramId: 910_003, isAllowed: true })
      .returning();
    const data = await loadProgress(database.db, blank?.id ?? 0, undefined, NOW);
    expect(data.streak).toEqual({ current: 0, best: 0 });
    expect(data.cards).toEqual({
      new: 0,
      learning: 0,
      review: 0,
      dueToday: 0,
      dueTomorrow: 0,
      wordsLearned: 0,
    });
    expect(data.activity).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(data.weak).toEqual([]);
  });

  describe("streakDays", () => {
    test("across user-local midnight the run stays current only until a full day is missed", async () => {
      const { db } = database;
      // 22:30Z on the 15th: 15th in UTC, already the 16th in Kyiv. Run 12-15 ended "yesterday".
      expect(await streakDays(db, userId, { now: NOW, timezone: TZ })).toEqual({
        current: 4,
        best: 6,
      });
      // The same instant in UTC: the 15th is today and is part of the run.
      expect(await streakDays(db, userId, { now: NOW, timezone: "UTC" })).toEqual({
        current: 4,
        best: 6,
      });
      // 22:30Z on the 16th is the 17th in Kyiv: the 16th was missed, the run is over.
      const later = new Date("2026-03-16T22:30:00Z");
      expect(await streakDays(db, userId, { now: later, timezone: TZ })).toEqual({
        current: 0,
        best: 6,
      });
      // ...but in UTC it is still the 16th, whose goal is not met yet, so the run holds.
      expect(await streakDays(db, userId, { now: later, timezone: "UTC" })).toEqual({
        current: 4,
        best: 6,
      });
    });

    test("an invalid timezone falls back to UTC", async () => {
      expect(await streakDays(database.db, userId, { now: NOW, timezone: "Mars/Base" })).toEqual({
        current: 4,
        best: 6,
      });
    });
  });
});
