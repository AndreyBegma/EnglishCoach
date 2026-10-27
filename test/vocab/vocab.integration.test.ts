import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findActiveSession } from "../../src/db/repositories/sessions";
import { findUserByTelegramId, updateSettings } from "../../src/db/repositories/users";
import { cards, dailyStats, mistakes, reviewLogs, words } from "../../src/db/schema";
import { LlmProviderError } from "../../src/llm";
import { encodeVocabCallback, type VocabCallback } from "../../src/vocab/callbacks";
import { EVIDENCE } from "../../src/vocab/mastery";
import { Scheduler } from "../../src/vocab/scheduler";
import { localDate } from "../../src/vocab/stats";
import { createHarness, type Harness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { meaningOf, vocabSkills } from "./fake-llm";

const DAY = 86_400_000;

describe.skipIf(!testServerUrl)("vocabulary sessions with a mocked Telegram API", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    await database.db.insert(words).values(
      ["decide", "borrow", "journey"].map((lemma, rank) => ({
        lemma,
        pos: "verb",
        cefrLevel: "A2" as const,
        frequencyRank: rank + 1,
        source: "test",
      })),
    );
  });
  afterAll(() => database.close());

  let nextUser = 910_001;
  async function setup(wordsPerDay = 2) {
    const telegramId = nextUser++;
    const llm = vocabSkills(database.db);
    const h = createHarness(database.db, { adminIds: [telegramId], skills: llm.skills });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    await updateSettings(database.db, user.id, { cefrLevel: "A2", wordsPerDay, timezone: "UTC" });
    return { h, telegramId, user, llm };
  }

  const botMessages = (h: Harness, telegramId: number) =>
    [...h.telegram.chat(telegramId).values()].filter((message) => message.from === "bot");
  const last = (h: Harness, telegramId: number) => {
    const message = botMessages(h, telegramId).at(-1);
    if (!message) throw new Error("no bot message");
    return message;
  };
  const press = (h: Harness, telegramId: number, callback: VocabCallback) =>
    h.press(telegramId, last(h, telegramId).id, encodeVocabCallback(callback));

  async function openFromHub(
    h: Harness,
    telegramId: number,
    userId: number,
    activity: "learn" | "review",
  ) {
    const hub = await getHub(database.db, userId);
    if (!hub) throw new Error("no hub");
    await h.press(telegramId, hub.messageId, encodeCallback({ type: "activity", activity }));
  }

  async function cardOf(userId: number, front: string) {
    const [card] = await database.db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.front, front)));
    if (!card) throw new Error(`no card ${front}`);
    return card;
  }

  /** After a session ends, the chat holds nothing but the fresh hub. */
  async function expectOnlyHub(h: Harness, telegramId: number, userId: number) {
    const hub = await getHub(database.db, userId);
    expect([...h.telegram.chat(telegramId).keys()]).toEqual([hub?.messageId ?? -1]);
    expect(await findActiveSession(database.db, userId)).toBeUndefined();
    return h.telegram.chat(telegramId).get(hub?.messageId ?? -1)?.text ?? "";
  }

  /**
   * One window per session: once flash notes have faded, the chat holds the hub and `window` and
   * nothing else. Returns the window.
   */
  async function expectOneWindow(h: Harness, telegramId: number, userId: number, window: number) {
    await h.sessions.flushNotes();
    const hub = await getHub(database.db, userId);
    expect([...h.telegram.chat(telegramId).keys()]).toEqual([hub?.messageId ?? -1, window]);
    return last(h, telegramId);
  }

  test("one window: a 3-word Learn session edits a single message, answers and notes vanish", async () => {
    const { h, telegramId, user } = await setup(3);
    await openFromHub(h, telegramId, user.id, "learn");
    const window = last(h, telegramId).id;
    const lemmas = ["decide", "borrow", "journey"];

    for (const [index, lemma] of lemmas.entries()) {
      const card = await cardOf(user.id, lemma);
      const shown = await expectOneWindow(h, telegramId, user.id, window);
      expect(shown.text).toContain(`${lemma}-translation`);
      if (index > 0) expect(shown.text).toStartWith(`✅ Right — <b>${lemmas[index - 1]}</b>`);

      // Typing instead of tapping: the message is deleted, a note says so and then fades.
      const typed = await h.say(telegramId, "hello?");
      expect(h.telegram.chat(telegramId).has(typed)).toBe(false);
      expect(last(h, telegramId).text).toBe("Use the buttons above.");
      await expectOneWindow(h, telegramId, user.id, window);

      await press(h, telegramId, { op: "got-it", cardId: card.id });
      expect((await expectOneWindow(h, telegramId, user.id, window)).text).toContain(
        "Pick the meaning.",
      );
      await press(h, telegramId, { op: "choice", cardId: card.id, index: 0 });
    }

    // The last result leads the "done for today" screen; the old buttons are all gone.
    const done = await expectOneWindow(h, telegramId, user.id, window);
    expect(done.text).toStartWith("✅ Right — <b>journey</b>");
    expect(done.text).toContain("You have learned 3 new words today");
    expect(done.buttons.flat()).toEqual([
      encodeVocabCallback({ op: "add-word" }),
      encodeVocabCallback({ op: "finish" }),
    ]);

    await press(h, telegramId, { op: "finish" });
    expect(await expectOnlyHub(h, telegramId, user.id)).toContain("+3 new");
  });

  test("two hints in a row never stack: the second replaces the first", async () => {
    const { h, telegramId, user } = await setup(2);
    await openFromHub(h, telegramId, user.id, "learn");
    const window = last(h, telegramId).id;
    await h.say(telegramId, "one");
    await h.say(telegramId, "two");
    const notes = botMessages(h, telegramId).filter((m) => m.text === "Use the buttons above.");
    expect(notes).toHaveLength(1);
    await expectOneWindow(h, telegramId, user.id, window);
  });

  test("a 2-word Learn session: card → check → FSRS card, then cleanup and a hub summary", async () => {
    const { h, telegramId, user, llm } = await setup(2);
    await openFromHub(h, telegramId, user.id, "learn");

    // Card 1: the most frequent unseen A2 word, enriched once.
    const first = last(h, telegramId);
    expect(first.text).toContain("decide");
    expect(first.text).toContain("/decide/");
    expect(first.text).toContain("decide-translation");
    expect(first.text).toContain("I decide every day.");
    expect(first.text).toContain("Collocations: decide fast, decide well, never decide");
    expect(first.text).toContain("💡 Think of decide.");
    const decide = await cardOf(user.id, "decide");
    expect(decide).toMatchObject({ itemType: "word", state: 0, reps: 0 });
    expect(first.buttons[0]?.[0]).toBe(encodeVocabCallback({ op: "got-it", cardId: decide.id }));

    // Got it → recognition check; the right meaning → Good.
    await press(h, telegramId, { op: "got-it", cardId: decide.id });
    const check = last(h, telegramId);
    expect(check.text).toContain("Pick the meaning.");
    expect(check.labels.flat()).toEqual([
      meaningOf("decide"),
      "wrong one",
      "wrong two",
      "wrong three",
    ]);
    await press(h, telegramId, { op: "choice", cardId: decide.id, index: 0 });

    // A second tap on the answered question changes nothing, and says so.
    const before = botMessages(h, telegramId).length;
    await h.press(
      telegramId,
      check.id,
      encodeVocabCallback({ op: "choice", cardId: decide.id, index: 0 }),
    );
    expect(botMessages(h, telegramId).length).toBe(before);
    expect(h.telegram.callsOf("answerCallbackQuery").at(-1)?.payload).toMatchObject({
      text: "This question is already answered",
    });

    // Card 2, answered wrong → Again.
    const borrow = await cardOf(user.id, "borrow");
    expect(last(h, telegramId).text).toContain("borrow");
    await press(h, telegramId, { op: "got-it", cardId: borrow.id });
    await press(h, telegramId, { op: "choice", cardId: borrow.id, index: 2 });

    // Today's two words are done.
    expect(last(h, telegramId).text).toContain("You have learned 2 new words today");
    await press(h, telegramId, { op: "finish" });

    const hubText = await expectOnlyHub(h, telegramId, user.id);
    expect(hubText).toContain("+2 new · 50 %");

    const after = await database.db
      .select()
      .from(cards)
      .where(eq(cards.userId, user.id))
      .orderBy(asc(cards.id));
    expect(after.map((card) => [card.front, card.reps])).toEqual([
      ["decide", 1],
      ["borrow", 1],
    ]);
    expect(after.every((card) => card.state !== 0)).toBe(true);
    const logs = await database.db
      .select()
      .from(reviewLogs)
      .where(
        inArray(
          reviewLogs.cardId,
          after.map((card) => card.id),
        ),
      )
      .orderBy(asc(reviewLogs.id));
    expect(logs.map((log) => log.rating)).toEqual([3, 1]);
    const [stats] = await database.db
      .select()
      .from(dailyStats)
      .where(
        and(eq(dailyStats.userId, user.id), eq(dailyStats.date, localDate(new Date(), "UTC"))),
      );
    expect(stats).toMatchObject({ newWords: 2, reviews: 0 });
    expect(llm.calls).toEqual({ enrich: 2, exercise: 2, check: 0 });
  });

  test("enrichment is cached: a card left unchecked comes back next session without the LLM", async () => {
    const { h, telegramId, user, llm } = await setup(2);
    await openFromHub(h, telegramId, user.id, "learn");
    const card = await cardOf(user.id, "decide");
    expect(llm.calls.enrich).toBe(1);

    await h.say(telegramId, "/cancel");
    await expectOnlyHub(h, telegramId, user.id);
    // The unchecked card is pending, not due: the hub's Review count leaves it out.
    const hub = await getHub(database.db, user.id);
    expect(
      h.telegram
        .chat(telegramId)
        .get(hub?.messageId ?? -1)
        ?.labels.flat(),
    ).toContain("🔁 Review (0)");

    await openFromHub(h, telegramId, user.id, "learn");
    const shown = last(h, telegramId);
    expect(shown.text).toContain("decide-translation");
    expect(shown.buttons[0]?.[0]).toBe(encodeVocabCallback({ op: "got-it", cardId: card.id }));
    expect(llm.calls.enrich).toBe(1);
  });

  test("💯 know: the word is skipped for good, does not use the daily limit, and can be undone", async () => {
    const { h, telegramId, user } = await setup(2);
    await openFromHub(h, telegramId, user.id, "learn");
    const decide = await cardOf(user.id, "decide");
    expect(last(h, telegramId).buttons[0]?.[1]).toBe(
      encodeVocabCallback({ op: "know", cardId: decide.id }),
    );

    const window = last(h, telegramId).id;
    await press(h, telegramId, { op: "know", cardId: decide.id });
    expect((await cardOf(user.id, "decide")).knownAt).toBeInstanceOf(Date);
    // The replacement is shown in the same window, the result and its Undo on top.
    const replaced = last(h, telegramId);
    expect(replaced.id).toBe(window);
    expect(replaced.text).toStartWith("💯 “decide” is marked as known");
    expect(replaced.text).toContain("borrow");
    expect(replaced.buttons[0]?.[0]).toBe(encodeVocabCallback({ op: "unknow", cardId: decide.id }));

    // Undo: the word is back in learning and shown first.
    await press(h, telegramId, { op: "unknow", cardId: decide.id });
    expect((await cardOf(user.id, "decide")).knownAt).toBeNull();
    const undone = last(h, telegramId);
    expect(undone.id).toBe(window);
    expect(undone.text).toStartWith("↩️ “decide” is back in learning");
    expect(undone.buttons[0]?.[0]).toBe(encodeVocabCallback({ op: "got-it", cardId: decide.id }));
    await press(h, telegramId, { op: "know", cardId: decide.id });

    // Two more words still fit today's limit of two: the known one consumed nothing.
    const borrow = await cardOf(user.id, "borrow");
    await press(h, telegramId, { op: "got-it", cardId: borrow.id });
    await press(h, telegramId, { op: "choice", cardId: borrow.id, index: 0 });
    expect(last(h, telegramId).text).toContain("journey");
    const journey = await cardOf(user.id, "journey");
    await press(h, telegramId, { op: "got-it", cardId: journey.id });
    await press(h, telegramId, { op: "choice", cardId: journey.id, index: 0 });
    expect(last(h, telegramId).text).toContain("You have learned 2 new words today");
    const [stats] = await database.db
      .select()
      .from(dailyStats)
      .where(eq(dailyStats.userId, user.id));
    expect(stats?.newWords).toBe(2);
    expect((await cardOf(user.id, "decide")).knownAt).toBeInstanceOf(Date);
    expect(last(h, telegramId).id).toBe(window);
  });

  test("a known word is never offered again in a later session", async () => {
    const { h, telegramId, user } = await setup(5);
    await openFromHub(h, telegramId, user.id, "learn");
    const decide = await cardOf(user.id, "decide");
    await press(h, telegramId, { op: "know", cardId: decide.id });
    await h.say(telegramId, "/cancel");
    await expectOnlyHub(h, telegramId, user.id);

    await openFromHub(h, telegramId, user.id, "learn");
    expect(last(h, telegramId).text).toContain("borrow");
    expect(last(h, telegramId).text).not.toContain("decide");
  });

  test("+ my word: the learner's own word becomes an enriched user_word card", async () => {
    const { h, telegramId, user, llm } = await setup(2);
    await openFromHub(h, telegramId, user.id, "learn");
    await press(h, telegramId, { op: "add-word" });
    expect(last(h, telegramId).text).toContain("Send a word or phrase");

    const invalid = await h.say(telegramId, "<script>");
    expect(h.telegram.chat(telegramId).has(invalid)).toBe(false);
    expect(last(h, telegramId).text).toContain("Send one word or a short phrase");
    await h.sessions.flushNotes();
    const typed = await h.say(telegramId, "  look  forward ");
    expect(h.telegram.chat(telegramId).has(typed)).toBe(false);
    const card = await cardOf(user.id, "look forward");
    expect(card).toMatchObject({ itemType: "user_word", wordId: null, reps: 0 });
    expect(last(h, telegramId).text).toContain("look forward-translation");
    expect(llm.calls.enrich).toBe(2);

    await press(h, telegramId, { op: "finish" });
    expect(await expectOnlyHub(h, telegramId, user.id)).toContain("No new words this time.");
  });

  test("a 3-card Review: recognition, typed via vocab-check, a grammar pattern; overrides; cleanup", async () => {
    const { h, telegramId, user, llm } = await setup(2);
    const scheduler = new Scheduler();
    const now = Date.now();
    const reviewed = (stability: number, dueDaysAgo: number) => ({
      ...scheduler.newCard(new Date(now - 30 * DAY)),
      state: 2,
      reps: 3,
      stability,
      difficulty: 5,
      scheduledDays: Math.round(stability),
      lastReview: new Date(now - (dueDaysAgo + stability) * DAY),
      due: new Date(now - dueDaysAgo * DAY),
    });
    const back = (front: string) => ({
      translation: `${front}-translation`,
      examples: [{ en: `I ${front} it.`, translation: "x" }],
    });
    const [weak, firm, pattern] = await database.db
      .insert(cards)
      .values([
        {
          userId: user.id,
          itemType: "word",
          front: "quiet",
          backJson: back("quiet"),
          ...reviewed(1, 3),
        },
        {
          userId: user.id,
          itemType: "user_word",
          front: "borrow",
          backJson: back("borrow"),
          ...reviewed(5, 2),
          // Already recognised in text: the recall from the translation is what it lacks.
          evidence: EVIDENCE.text,
        },
        {
          userId: user.id,
          itemType: "grammar_pattern",
          front: "past simple of go",
          backJson: { translation: "Use went." },
          ...scheduler.newCard(new Date(now - DAY)),
        },
      ])
      .returning();
    if (!weak || !firm || !pattern) throw new Error("cards not inserted");
    await database.db.insert(mistakes).values({
      userId: user.id,
      category: "grammar",
      pattern: "past simple of go",
      exampleWrong: "Yesterday I goed home.",
      exampleRight: "Yesterday I went home.",
      explanation: "Go is irregular: went.",
      count: 2,
      cardId: pattern.id,
    });

    await h.say(telegramId, "/menu");
    const hub = await getHub(database.db, user.id);
    expect(
      h.telegram
        .chat(telegramId)
        .get(hub?.messageId ?? -1)
        ?.labels.flat(),
    ).toContain("🔁 Review (3)");

    await openFromHub(h, telegramId, user.id, "review");
    expect(last(h, telegramId).text).toContain("3 cards to review");
    // Every step below is the same window, edited in place.
    const window = last(h, telegramId).id;
    await press(h, telegramId, { op: "start" });

    // 1. Low stability → recognition by buttons; right → Good suggested; the learner says Hard.
    expect((await expectOneWindow(h, telegramId, user.id, window)).text).toContain("<b>quiet</b>");
    await h.say(telegramId, "quiet");
    expect(last(h, telegramId).text).toBe("Use the buttons above.");
    await press(h, telegramId, { op: "choice", cardId: weak.id, index: 0 });
    const feedback = await expectOneWindow(h, telegramId, user.id, window);
    expect(feedback.text).toContain("✅ Correct.");
    expect(feedback.labels[0]).toEqual(["Again", "Hard", "✓ Good", "Easy"]);
    await press(h, telegramId, { op: "rate", cardId: weak.id, rating: "hard" });

    // 2. Stability 5 → production, typed; a near miss goes to vocab-check; the learner says Good.
    expect((await expectOneWindow(h, telegramId, user.id, window)).text).toContain(
      "Type the word.",
    );
    llm.checks.push({
      verdict: "close",
      accepted_as: "typo",
      suggested_rating: "hard",
      feedback: "Spelling: borrow.",
    });
    const typed = await h.say(telegramId, "borow");
    // The typed answer is deleted once read; the feedback repeats it.
    expect(h.telegram.chat(telegramId).has(typed)).toBe(false);
    const judged = await expectOneWindow(h, telegramId, user.id, window);
    expect(judged.text).toStartWith("Your answer: <i>borow</i>");
    expect(judged.text).toContain("Spelling: borrow.");
    expect(judged.labels[0]).toEqual(["Again", "✓ Hard", "Good", "Easy"]);
    await press(h, telegramId, { op: "rate", cardId: firm.id, rating: "good" });

    // 3. The grammar pattern: fix the sentence, reveal, self-grade Again.
    expect((await expectOneWindow(h, telegramId, user.id, window)).text).toContain(
      "Yesterday I goed home.",
    );
    await press(h, telegramId, { op: "reveal", cardId: pattern.id });
    const answer = await expectOneWindow(h, telegramId, user.id, window);
    expect(answer.text).toContain("Yesterday I went home.");
    expect(answer.text).toContain("Go is irregular: went.");
    expect(answer.labels[0]).toEqual(["Again", "Hard", "Good", "Easy"]);
    await press(h, telegramId, { op: "rate", cardId: pattern.id, rating: "again" });

    // Nothing left: the session ends by itself.
    const hubText = await expectOnlyHub(h, telegramId, user.id);
    expect(hubText).toContain("3 reviewed · 67 %");

    const logs = await database.db
      .select()
      .from(reviewLogs)
      .where(inArray(reviewLogs.cardId, [weak.id, firm.id, pattern.id]))
      .orderBy(asc(reviewLogs.id));
    expect(logs.map((log) => [log.cardId, log.rating])).toEqual([
      [weak.id, 2],
      [firm.id, 3],
      [pattern.id, 1],
    ]);
    const after = await database.db
      .select()
      .from(cards)
      .where(inArray(cards.id, [weak.id, firm.id]));
    expect(after.every((card) => card.due.getTime() > now)).toBe(true);
    const [stats] = await database.db
      .select()
      .from(dailyStats)
      .where(eq(dailyStats.userId, user.id));
    expect(stats).toMatchObject({ reviews: 3, newWords: 0 });
    expect(llm.calls).toEqual({ enrich: 0, exercise: 2, check: 1 });
  });

  test("a failed LLM call is reported with Retry, and nothing is stored until it succeeds", async () => {
    const { h, telegramId, user, llm } = await setup(2);
    llm.failure.next = new LlmProviderError("server", "server request failed: 503", 503);
    await openFromHub(h, telegramId, user.id, "learn");
    expect(last(h, telegramId).text).toContain("did not answer properly");
    expect(await database.db.select().from(cards).where(eq(cards.userId, user.id))).toEqual([]);

    await press(h, telegramId, { op: "retry" });
    expect(last(h, telegramId).text).toContain("decide-translation");
    expect(h.logs.join("\n")).toContain("vocabulary LLM call failed");
  });

  const failurePrompts = (h: Harness, telegramId: number) =>
    botMessages(h, telegramId).filter((message) =>
      message.text.includes("did not answer properly"),
    );
  const fail = () => new LlmProviderError("server", "server request failed: 503", 503);

  test("Learn: Retry removes the tapped failure prompt, so at most one is ever on screen", async () => {
    const { h, telegramId, user, llm } = await setup(2);
    llm.failure.next = fail();
    await openFromHub(h, telegramId, user.id, "learn");
    expect(failurePrompts(h, telegramId)).toHaveLength(1);

    llm.failure.next = fail();
    await press(h, telegramId, { op: "retry" });
    expect(failurePrompts(h, telegramId)).toHaveLength(1);

    await press(h, telegramId, { op: "finish" });
    expect(await expectOnlyHub(h, telegramId, user.id)).toBeDefined();
    expect(failurePrompts(h, telegramId)).toHaveLength(0);
  });

  test("Review: Retry removes the tapped failure prompt, so at most one is ever on screen", async () => {
    const { h, telegramId, user, llm } = await setup(2);
    const scheduler = new Scheduler();
    const now = Date.now();
    await database.db.insert(cards).values({
      userId: user.id,
      itemType: "word",
      front: "quiet",
      backJson: {
        translation: "quiet-translation",
        examples: [{ en: "I quiet it.", translation: "x" }],
      },
      ...scheduler.newCard(new Date(now - 30 * DAY)),
      state: 2,
      reps: 3,
      stability: 1,
      difficulty: 5,
      scheduledDays: 1,
      lastReview: new Date(now - 4 * DAY),
      due: new Date(now - 3 * DAY),
    });
    await openFromHub(h, telegramId, user.id, "review");
    llm.failure.next = fail();
    await press(h, telegramId, { op: "start" });
    expect(failurePrompts(h, telegramId)).toHaveLength(1);

    llm.failure.next = fail();
    await press(h, telegramId, { op: "retry" });
    expect(failurePrompts(h, telegramId)).toHaveLength(1);

    await press(h, telegramId, { op: "finish" });
    expect(failurePrompts(h, telegramId)).toHaveLength(0);
  });

  test("Review with nothing due ends at once and says so", async () => {
    const { h, telegramId, user } = await setup(2);
    await openFromHub(h, telegramId, user.id, "review");
    expect(await expectOnlyHub(h, telegramId, user.id)).toContain("Nothing to review right now.");
  });
});
