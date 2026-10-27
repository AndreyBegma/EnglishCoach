import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import type { Transformer } from "grammy";
import { createI18n } from "../../src/bot/i18n";
import type { Database } from "../../src/db/client";
import { isGoalMet } from "../../src/db/repositories/daily";
import { lastSummaryLine } from "../../src/db/repositories/sessions";
import {
  findUserByTelegramId,
  getOrCreateUser,
  updateSettings,
} from "../../src/db/repositories/users";
import {
  dailyStats,
  type LearningSession,
  learningSessions,
  mistakes,
  streakDays,
  userStreak,
  xpEvents,
} from "../../src/db/schema";
import { createLogger } from "../../src/log";
import { MemoryRoutineJobs, MemoryRoutineStore, Routine } from "../../src/routine";
import { encodeRoutineCallback } from "../../src/routine/callbacks";
import { MAX_SNOOZES, SNOOZE_MS } from "../../src/routine/routine";
import { localDate } from "../../src/routine/time";
import type { SkillRunner } from "../../src/skills";
import { createHarness, type Harness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

describe.skipIf(!testServerUrl)("daily routine", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  let nextTelegramId = 930_001;

  /** An admin learner with a level, in Kyiv, who has opened the menu once. */
  async function setup(options: { skills?: SkillRunner } = {}) {
    const telegramId = nextTelegramId++;
    const h = createHarness(database.db, { adminIds: [telegramId], skills: options.skills });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    await updateSettings(database.db, user.id, { cefrLevel: "B1", timezone: "Europe/Kyiv" });
    await h.settingsEvents.emit({ userId: user.id, changed: ["cefrLevel"] });
    const jobs = h.routineJobs as MemoryRoutineJobs;
    const store = h.routineStore as MemoryRoutineStore;
    return { h, telegramId, user, jobs, store };
  }

  const botMessages = (h: Harness, telegramId: number) =>
    [...h.telegram.chat(telegramId).values()].filter((message) => message.from === "bot");
  const sendsTo = (h: Harness, telegramId: number) =>
    h.telegram.callsOf("sendMessage").filter((call) => Number(call.payload.chat_id) === telegramId);

  /** Telegram answers 403 to every message for `telegramId`, as for a user who blocked the bot. */
  function blockBot(h: Harness, telegramId: number) {
    const state = { blocked: true };
    const blocked: Transformer = async (prev, method, payload, signal) => {
      const chatId = Number((payload as { chat_id?: unknown } | undefined)?.chat_id);
      if (state.blocked && method === "sendMessage" && chatId === telegramId) {
        return {
          ok: false,
          error_code: 403,
          description: "Forbidden: bot was blocked by the user",
        } as never;
      }
      return prev(method, payload, signal);
    };
    h.bot.api.config.use(blocked);
    return state;
  }

  async function addMistake(userId: number, pattern: string) {
    await database.db.insert(mistakes).values({
      userId,
      category: "grammar",
      pattern,
      exampleWrong: "I have seen him yesterday.",
      exampleRight: "I saw him yesterday.",
      explanation: "A finished past time takes the past simple.",
    });
  }

  async function sessionsOf(userId: number): Promise<LearningSession[]> {
    return database.db
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.userId, userId))
      .orderBy(asc(learningSessions.id));
  }

  describe("scheduling", () => {
    test("a learner with a level gets three jobs in their own time zone", async () => {
      const { user, jobs } = await setup();
      expect(jobs.scheduled.get(user.id)).toEqual([
        { slot: "morning", pattern: "30 8 * * *", tz: "Europe/Kyiv" },
        { slot: "evening", pattern: "0 20 * * *", tz: "Europe/Kyiv" },
        // Evening + 2 h is 22:00, the start of quiet hours: pulled back to 21:30.
        { slot: "reminder", pattern: "30 21 * * *", tz: "Europe/Kyiv" },
      ]);
    });

    test("changing a time reschedules; an unrelated setting does not", async () => {
      const { h, user, jobs } = await setup();
      await updateSettings(database.db, user.id, { morningTime: "07:00", timezone: "Asia/Tokyo" });
      await h.settingsEvents.emit({ userId: user.id, changed: ["morningTime", "timezone"] });
      expect(jobs.scheduled.get(user.id)?.[0]).toEqual({
        slot: "morning",
        pattern: "0 7 * * *",
        tz: "Asia/Tokyo",
      });

      jobs.scheduled.delete(user.id);
      await h.settingsEvents.emit({ userId: user.id, changed: ["uiLang"] });
      expect(jobs.scheduled.has(user.id)).toBe(false);
    });

    test("a learner without a level has no jobs", async () => {
      const telegramId = nextTelegramId++;
      const h = createHarness(database.db, { adminIds: [telegramId] });
      await h.say(telegramId, "/menu");
      const user = await findUserByTelegramId(database.db, telegramId);
      expect(user && (h.routineJobs as MemoryRoutineJobs).scheduled.has(user.id)).toBe(false);
    });

    test("boot reconcile covers allowed users and admins", async () => {
      const { h, user, jobs } = await setup();
      jobs.scheduled.clear();
      await h.routine.reconcileAll();
      expect(jobs.scheduled.has(user.id)).toBe(true);
    });
  });

  describe("prompts", () => {
    test("the morning plan falls back to a template and has Start and Later", async () => {
      const { h, telegramId, user, store } = await setup();
      expect(await h.routine.fire({ userId: user.id, slot: "morning" })).toBe("sent");

      const prompt = botMessages(h, telegramId).at(-1);
      expect(prompt?.text).toContain("Good morning");
      expect(prompt?.buttons).toEqual([
        [encodeRoutineCallback({ type: "start", set: "morning" })],
        [encodeRoutineCallback({ type: "later" })],
      ]);
      expect(store.prompts.get(user.id)).toEqual({
        messageId: prompt?.id ?? -1,
        slot: "morning",
        snoozes: 0,
      });
    });

    test("the plan comes from the routine-plan skill when it answers", async () => {
      const calls: unknown[] = [];
      const skills = {
        runSkill: async (_userId: number, skillId: string, vars: unknown) => {
          calls.push({ skillId, vars });
          return { data: { text: "Your plan for today" } };
        },
      } as unknown as SkillRunner;
      const { h, telegramId, user } = await setup({ skills });
      const today = localDate(new Date(), "Europe/Kyiv");
      const yesterday = localDate(new Date(Date.now() - 86_400_000), "Europe/Kyiv");
      await database.db.insert(dailyStats).values([
        { userId: user.id, date: yesterday, goalMet: true },
        { userId: user.id, date: today, goalMet: true },
      ]);
      await addMistake(user.id, "articles before uncountable nouns");
      await h.routine.fire({ userId: user.id, slot: "evening" });

      expect(botMessages(h, telegramId).at(-1)?.text).toBe("Your plan for today");
      expect(calls).toEqual([
        {
          skillId: "routine-plan",
          vars: {
            slot: "evening",
            due_reviews: 0,
            new_words: 0,
            grammar_items: 10,
            mistakes_to_review: 1,
            streak_days: 2,
          },
        },
      ]);
    });

    test("one unsolicited message per slot and day", async () => {
      const { h, telegramId, user } = await setup();
      h.telegram.reset();
      expect(await h.routine.fire({ userId: user.id, slot: "morning" })).toBe("sent");
      expect(await h.routine.fire({ userId: user.id, slot: "morning" })).toBe("skipped");
      expect(sendsTo(h, telegramId)).toHaveLength(1);
    });

    test("the next routine replaces the previous prompt", async () => {
      const { h, telegramId, user } = await setup();
      await h.routine.fire({ userId: user.id, slot: "morning" });
      const morning = botMessages(h, telegramId).at(-1);
      await h.routine.fire({ userId: user.id, slot: "evening" });

      const remaining = botMessages(h, telegramId).map((message) => message.id);
      expect(remaining).not.toContain(morning?.id);
      expect(botMessages(h, telegramId).at(-1)?.text).toContain("Evening practice");
    });

    test("nothing is sent to a user who is not on the allowlist, and their jobs go", async () => {
      const h = createHarness(database.db);
      const user = await getOrCreateUser(database.db, { telegramId: nextTelegramId++ });
      await updateSettings(database.db, user.id, { cefrLevel: "B1" });
      const jobs = h.routineJobs as MemoryRoutineJobs;
      await jobs.schedule(user.id, []);

      expect(await h.routine.fire({ userId: user.id, slot: "morning" })).toBe("skipped");
      expect(sendsTo(h, user.telegramId)).toHaveLength(0);
      expect(jobs.scheduled.has(user.id)).toBe(false);
    });
  });

  describe("Telegram 403", () => {
    test("disables the user's jobs and stops sending until they write again", async () => {
      const { h, telegramId, user, jobs, store } = await setup();
      blockBot(h, telegramId);

      expect(await h.routine.fire({ userId: user.id, slot: "morning" })).toBe("blocked");
      expect(jobs.scheduled.has(user.id)).toBe(false);
      expect(store.blocked.has(user.id)).toBe(true);
      // The slot stays claimed: a retry of the job does not knock again.
      expect(await h.routine.fire({ userId: user.id, slot: "evening" })).toBe("skipped");
      expect(await h.routine.reconcile(user.id)).toBe(false);
    });

    test("a message from the user lifts the block and restores the jobs", async () => {
      const { h, telegramId, user, jobs, store } = await setup();
      const telegram = blockBot(h, telegramId);
      expect(await h.routine.fire({ userId: user.id, slot: "morning" })).toBe("blocked");
      expect(jobs.scheduled.has(user.id)).toBe(false);

      // The user unblocks the bot and writes.
      telegram.blocked = false;
      await h.say(telegramId, "/menu");
      expect(store.blocked.has(user.id)).toBe(false);
      expect(jobs.scheduled.has(user.id)).toBe(true);
    });

    test("any other send failure gives the slot back so the job's retry can send", async () => {
      const { h, telegramId, user, store } = await setup();
      const failing: Transformer = async (prev, method, payload, signal) =>
        method === "sendMessage"
          ? ({ ok: false, error_code: 429, description: "Too Many Requests" } as never)
          : prev(method, payload, signal);
      h.bot.api.config.use(failing);

      await expect(h.routine.fire({ userId: user.id, slot: "morning" })).rejects.toThrow();
      expect(store.blocked.has(user.id)).toBe(false);
      expect(await store.claimSlot(user.id, "morning", localDate(new Date(), "Europe/Kyiv"))).toBe(
        true,
      );
      expect(sendsTo(h, telegramId)).toHaveLength(1);
    });
  });

  /** A routine on a pinned clock, over the harness's bot, for a fresh learner in Kyiv. */
  async function routineAt(now: Date) {
    const { h, user, telegramId } = await setup();
    const store = new MemoryRoutineStore();
    const routine = new Routine({
      api: h.bot.api,
      db: database.db,
      i18n: createI18n(),
      log: createLogger({ write: () => {} }),
      skills: h.skills,
      sessions: h.sessions,
      jobs: new MemoryRoutineJobs(),
      store,
      adminIds: [user.telegramId],
      now: () => now,
    });
    // The hub `/menu` sent is not the routine's.
    const before = sendsTo(h, telegramId).length;
    const sent = () => sendsTo(h, telegramId).slice(before);
    return { routine, user, store, sent };
  }

  const ended = (user: { id: number; telegramId: number }, startedAt: Date) => ({
    session: { id: 0, userId: user.id, startedAt } as LearningSession,
    user,
    status: "finished" as const,
  });

  describe("reminder", () => {
    // 21:30 in Kyiv (EEST) on 1 July: the default reminder time, before quiet hours.
    const EVENING = new Date("2026-07-01T18:30:00Z");

    test("nudges once when the goal is open, never when it is met or reminders are off", async () => {
      const { routine, user, store, sent } = await routineAt(EVENING);
      expect(await routine.fire({ userId: user.id, slot: "reminder" })).toBe("sent");
      expect(store.prompts.get(user.id)?.slot).toBe("reminder");
      // Dedupe: a second fire the same local day (a retry, a rescheduled job) sends nothing.
      expect(await routine.fire({ userId: user.id, slot: "reminder" })).toBe("skipped");
      expect(sent()).toHaveLength(1);

      const other = await routineAt(EVENING);
      await database.db.insert(dailyStats).values({
        userId: other.user.id,
        date: "2026-07-01",
        goalMet: true,
        newWords: 5,
        reviews: 1,
      });
      expect(await other.routine.fire({ userId: other.user.id, slot: "reminder" })).toBe("skipped");

      const third = await routineAt(EVENING);
      await updateSettings(database.db, third.user.id, { remindersEnabled: false });
      expect(await third.routine.fire({ userId: third.user.id, slot: "reminder" })).toBe("skipped");
    });

    test("tells how many hours the streak has left", async () => {
      const { routine, user, sent } = await routineAt(EVENING);
      await database.db.insert(dailyStats).values(
        ["2026-06-28", "2026-06-29", "2026-06-30"].map((date) => ({
          userId: user.id,
          date,
          goalMet: true,
          newWords: 5,
          reviews: 1,
        })),
      );
      expect(await routine.fire({ userId: user.id, slot: "reminder" })).toBe("sent");
      // 21:30 → midnight is 2.5 h, rounded up.
      expect(sent()[0]?.payload.text).toBe(
        "🔥 Your 3-day streak burns in 3 h. A few minutes now keep it going.",
      );
    });

    test("not in quiet hours, and the day's slot stays open for a later fire", async () => {
      const late = await routineAt(new Date("2026-07-01T19:30:00Z")); // 22:30 in Kyiv
      expect(await late.routine.fire({ userId: late.user.id, slot: "reminder" })).toBe("skipped");
      expect(late.sent()).toHaveLength(0);
      expect(late.store.claims.size).toBe(0);
    });

    test("at most three unsolicited messages a day", async () => {
      const { routine, user, store, sent } = await routineAt(EVENING);
      for (const _ of [1, 2, 3]) await store.reserveNotification(user.id, "2026-07-01", 3);
      expect(await routine.fire({ userId: user.id, slot: "reminder" })).toBe("skipped");
      expect(sent()).toHaveLength(0);
    });
  });

  describe("streak on session end", () => {
    const goalDay = (userId: number, date: string) => ({
      userId,
      date,
      goalMet: true,
      newWords: 5,
      reviews: 1,
    });
    const days = (from: string, count: number) =>
      Array.from({ length: count }, (_, i) =>
        new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      );
    const milestoneAwards = async (userId: number) =>
      (await database.db.select().from(xpEvents).where(eq(xpEvents.userId, userId)))
        .filter((row) => "milestone" in row.meta)
        .map((row) => [row.meta.milestone, row.amount]);

    test("the seventh goal day pays the milestone bonus once", async () => {
      const now = new Date("2026-07-07T12:00:00Z");
      const { routine, user } = await routineAt(now);
      await database.db
        .insert(dailyStats)
        .values(days("2026-07-01", 6).map((date) => goalDay(user.id, date)));
      await database.db
        .insert(dailyStats)
        .values({ userId: user.id, date: "2026-07-07", newWords: 5, reviews: 1 });
      await routine.onSessionEnded(ended(user, now));
      await routine.onSessionEnded(ended(user, now));
      expect(await milestoneAwards(user.id)).toEqual([[7, 50]]);
    });

    test("a double goal after a break restores the streak and pays the milestones it passes", async () => {
      const now = new Date("2026-07-12T12:00:00Z");
      const { routine, user } = await routineAt(now);
      // 1–10 July met, no freeze left, the 11th missed; on the 12th a double goal.
      await database.db
        .insert(dailyStats)
        .values(days("2026-07-01", 10).map((date) => goalDay(user.id, date)));
      await database.db.insert(userStreak).values({
        userId: user.id,
        freezes: 0,
        grantedWeek: "2026-07-13",
        settledThrough: "2026-07-10",
      });
      await database.db
        .insert(dailyStats)
        .values({ userId: user.id, date: "2026-07-12", newWords: 10, reviews: 2 });
      await routine.onSessionEnded(ended(user, now));
      const [restored] = await database.db
        .select()
        .from(streakDays)
        .where(eq(streakDays.userId, user.id));
      expect(restored).toMatchObject({ date: "2026-07-11", kind: "restore" });
      // 1 → 12 days: the 7-day milestone, for the restored run.
      expect(await milestoneAwards(user.id)).toEqual([[7, 50]]);
    });
  });

  describe("buttons", () => {
    test("Later removes the prompt and snoozes it an hour, at most twice", async () => {
      const { h, telegramId, user, jobs, store } = await setup();
      await h.routine.fire({ userId: user.id, slot: "morning" });
      const first = store.prompts.get(user.id);
      await h.press(telegramId, first?.messageId ?? -1, encodeRoutineCallback({ type: "later" }));

      expect(h.telegram.chat(telegramId).has(first?.messageId ?? -1)).toBe(false);
      expect(jobs.snoozed).toEqual([{ userId: user.id, snoozes: 1, delayMs: SNOOZE_MS }]);

      // The snoozed re-send is not a new unsolicited slot: it goes out although morning was sent.
      expect(await h.routine.fire({ userId: user.id, slot: "morning", snoozes: MAX_SNOOZES })).toBe(
        "sent",
      );
      const last = botMessages(h, telegramId).at(-1);
      expect(last?.buttons).toEqual([[encodeRoutineCallback({ type: "start", set: "morning" })]]);
    });

    test("Start morning set runs review, then new words", async () => {
      const { h, telegramId, user, store } = await setup();
      await h.routine.fire({ userId: user.id, slot: "morning" });
      const prompt = store.prompts.get(user.id);
      await h.press(
        telegramId,
        prompt?.messageId ?? -1,
        encodeRoutineCallback({ type: "start", set: "morning" }),
      );

      expect(store.prompts.has(user.id)).toBe(false);
      expect(h.telegram.chat(telegramId).has(prompt?.messageId ?? -1)).toBe(false);
      // Nothing is due, so review ends at once and hands over to new words.
      expect((await sessionsOf(user.id)).map((session) => session.kind).slice(0, 2)).toEqual([
        "review",
        "vocab_new",
      ]);
    });

    async function startEvening(
      h: Harness,
      telegramId: number,
      userId: number,
      store: MemoryRoutineStore,
    ) {
      await h.routine.fire({ userId, slot: "evening" });
      await h.press(
        telegramId,
        store.prompts.get(userId)?.messageId ?? -1,
        encodeRoutineCallback({ type: "start", set: "evening" }),
      );
    }

    test("Start evening set practises today's mistakes, then hands over to review", async () => {
      const { h, telegramId, user, store } = await setup();
      await addMistake(user.id, "past simple vs present perfect");
      await startEvening(h, telegramId, user.id, store);

      const texts = botMessages(h, telegramId).map((message) => message.text);
      expect(texts.some((text) => text.includes("Practising your weak spots (1 patterns)"))).toBe(
        true,
      );
      const [grammar] = await sessionsOf(user.id);
      expect([grammar?.kind, grammar?.status]).toEqual(["grammar", "active"]);

      await h.sessions.end(grammar?.id ?? -1, "finished", { line: "grammar 8/10" });
      // Nothing is due, so review ends at once; the hub carries both lines.
      expect((await sessionsOf(user.id)).map((session) => session.kind)).toEqual([
        "grammar",
        "review",
      ]);
      expect(await lastSummaryLine(database.db, user.id)).toStartWith("grammar 8/10\n");
    });

    test("Start evening set without mistakes today is plain grammar (the topic picker)", async () => {
      const { h, telegramId, user, store } = await setup();
      await startEvening(h, telegramId, user.id, store);
      expect(botMessages(h, telegramId).at(-1)?.text).toContain("Pick a topic");
      expect((await sessionsOf(user.id)).map((session) => session.kind)).toEqual(["grammar"]);
    });

    test("a button of an older prompt is outdated and starts nothing", async () => {
      const { h, telegramId, user, store } = await setup();
      await h.routine.fire({ userId: user.id, slot: "morning" });
      const morning = store.prompts.get(user.id)?.messageId ?? -1;
      await h.routine.fire({ userId: user.id, slot: "evening" });

      await h.press(telegramId, morning, encodeRoutineCallback({ type: "start", set: "morning" }));
      expect(await sessionsOf(user.id)).toHaveLength(0);
      const answer = h.telegram.callsOf("answerCallbackQuery").at(-1);
      expect(answer?.payload.text).toBe("This reminder is no longer active.");
    });
  });

  describe("daily goal", () => {
    test("met when the new words are done and a review or grammar answer happened", async () => {
      const now = new Date("2026-07-01T12:00:00Z");
      const { routine, user } = await routineAt(now);
      await database.db
        .insert(dailyStats)
        .values({ userId: user.id, date: "2026-07-01", newWords: 4, reviews: 3 });
      await routine.onSessionEnded(ended(user, now));
      expect(await isGoalMet(database.db, user.id, "2026-07-01")).toBe(false);

      await database.db
        .update(dailyStats)
        .set({ newWords: 5, reviews: 0, grammarAnswered: 1 })
        .where(eq(dailyStats.userId, user.id));
      await routine.onSessionEnded(ended(user, now));
      expect(await isGoalMet(database.db, user.id, "2026-07-01")).toBe(true);
    });

    test("never unset once met", async () => {
      const now = new Date("2026-07-02T12:00:00Z");
      const { routine, user } = await routineAt(now);
      await database.db.insert(dailyStats).values({
        userId: user.id,
        date: "2026-07-02",
        newWords: 5,
        reviews: 1,
      });
      await routine.onSessionEnded(ended(user, now));
      await updateSettings(database.db, user.id, { wordsPerDay: 20 });
      await routine.onSessionEnded(ended(user, now));
      expect(await isGoalMet(database.db, user.id, "2026-07-02")).toBe(true);
    });

    test("a session across the learner's midnight counts for the day it started", async () => {
      // 23:50 → 00:10 in Kyiv (UTC+3); in UTC both instants are on 1 July.
      const startedAt = new Date("2026-07-01T20:50:00Z");
      const now = new Date("2026-07-01T21:10:00Z");
      const { routine, user } = await routineAt(now);
      expect(localDate(startedAt, "Europe/Kyiv")).toBe("2026-07-01");
      expect(localDate(now, "Europe/Kyiv")).toBe("2026-07-02");
      await database.db
        .insert(dailyStats)
        .values({ userId: user.id, date: "2026-07-01", newWords: 5, reviews: 2 });

      await routine.onSessionEnded(ended(user, startedAt));
      expect(await isGoalMet(database.db, user.id, "2026-07-01")).toBe(true);
      expect(await isGoalMet(database.db, user.id, "2026-07-02")).toBe(false);
    });

    test("a session ending recomputes the goal through the session manager", async () => {
      const { h, user } = await setup();
      const today = localDate(new Date(), "Europe/Kyiv");
      await database.db
        .insert(dailyStats)
        .values({ userId: user.id, date: today, newWords: 5, grammarAnswered: 1 });
      const outcome = await h.sessions.start(user, "grammar");
      if (!outcome.started) throw new Error("grammar did not start");
      await outcome.handle.end("cancelled");
      expect(await isGoalMet(database.db, user.id, today)).toBe(true);
    });
  });
});
