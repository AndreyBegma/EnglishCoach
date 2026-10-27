import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findUserByTelegramId, getSettings } from "../../src/db/repositories/users";
import { cards, dailyStats, learningSessions, mistakes } from "../../src/db/schema";
import { QUESTIONS_PER_SESSION } from "../../src/grammar";
import { encodeGrammarCallback } from "../../src/grammar/callbacks";
import { localDate } from "../../src/grammar/stats";
import { LlmProviderError } from "../../src/llm";
import { createHarness, type Harness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { choiceItem, scriptedSkills, typedItem, wrongCheck } from "./script";

const OPTIONS = ["has lived", "lives", "is living", "lived"];
const choice = (topic: string, correct = 0) =>
  choiceItem(topic, "She ___ here since 2019.", OPTIONS, correct);

describe.skipIf(!testServerUrl)("grammar session over a mocked Telegram API", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  let nextUser = 700_001;
  async function setup(queue: unknown[]) {
    const telegramId = nextUser++;
    const script = scriptedSkills(database.db, queue);
    const h = createHarness(database.db, { adminIds: [telegramId], skills: script.skills });
    // `/start` begins onboarding for a learner without a level; these tests start at the hub.
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    return { h, telegramId, user, ...script };
  }

  const lastBot = (h: Harness, telegramId: number) => {
    const messages = [...h.telegram.chat(telegramId).values()].filter((m) => m.from === "bot");
    const last = messages.at(-1);
    if (!last) throw new Error("no bot message");
    return last;
  };

  /** The feedback on the last answer: the lead of the next question (or error), in the window. */
  const feedback = lastBot;

  /** One window per session: once notes have faded, the chat holds the hub and the window only. */
  async function expectOneWindow(h: Harness, telegramId: number, userId: number) {
    await h.sessions.flushNotes();
    const hub = await getHub(database.db, userId);
    const chat = [...h.telegram.chat(telegramId).values()];
    expect(chat.map((m) => m.id)).toEqual([hub?.messageId ?? -1, lastBot(h, telegramId).id]);
    return lastBot(h, telegramId);
  }

  async function startGrammar(h: Harness, telegramId: number, userId: number) {
    const hub = await getHub(database.db, userId);
    await h.press(
      telegramId,
      hub?.messageId ?? 0,
      encodeCallback({ type: "activity", activity: "grammar" }),
    );
    return lastBot(h, telegramId);
  }

  const answer = (h: Harness, telegramId: number, n: number, option: number) =>
    h.press(
      telegramId,
      lastBot(h, telegramId).id,
      encodeGrammarCallback({ type: "answer", question: n, option }),
    );

  test("a full session: choice, typed correct, typed wrong twice; mistakes, card, stats, cleanup", async () => {
    const queue: unknown[] = [
      choice("present perfect"), // 1: answered correctly by button
      typedItem("gap_fill", "present perfect", "She ___ (live) here since 2019.", [
        "has lived",
        "'s lived",
      ]),
      typedItem("error_correction", "articles", "I bought car.", ["I bought a car."]),
      wrongCheck('Missing article before "singular" noun', "I bought a car."),
      typedItem("gap_fill", "articles", "He is ___ engineer.", ["an"]),
      wrongCheck("missing article  before singular noun!", "an"),
      ...Array.from({ length: QUESTIONS_PER_SESSION - 4 }, () => choice("modals")),
    ];
    const { h, telegramId, user, requests } = await setup(queue);

    const picker = await startGrammar(h, telegramId, user.id);
    // Mixed first, then every topic offered to a learner without a level (treated as B1).
    expect(picker.buttons[0]).toEqual([encodeGrammarCallback({ type: "topic", index: null })]);
    expect(picker.labels.flat()).toContain("Tenses");
    await h.press(telegramId, picker.id, encodeGrammarCallback({ type: "topic", index: null }));

    // 1: multiple choice, right option. The question is the picker, edited in place.
    const window = await expectOneWindow(h, telegramId, user.id);
    expect(window.id).toBe(picker.id);
    expect(window.text).toStartWith("Topic: 🎲 Mixed");
    expect(window.text).toContain("Question 1 of 10");
    expect(window.labels.flat()).toEqual(OPTIONS);
    // A typed message on a multiple-choice question: a note that fades, and the message is gone.
    const stray = await h.say(telegramId, "has lived");
    expect(h.telegram.chat(telegramId).has(stray)).toBe(false);
    expect(lastBot(h, telegramId).text).toBe("Please answer with the buttons above.");
    await expectOneWindow(h, telegramId, user.id);
    await answer(h, telegramId, 1, 0);
    expect(feedback(h, telegramId).text).toStartWith("Your answer: has lived\n✅ Correct!");
    expect(feedback(h, telegramId).text).not.toContain("Severity");
    expect((await expectOneWindow(h, telegramId, user.id)).id).toBe(picker.id);

    // 2: typed, exact match: no grammar-check call.
    expect(requests.at(-1)?.messages.at(-1)?.content).toMatch(/"recent_accuracy": 1\b/);
    const typed = await h.say(telegramId, "  Has lived. ");
    expect(h.telegram.chat(telegramId).has(typed)).toBe(false);
    expect(feedback(h, telegramId).text).toContain("✅ Correct!");
    expect(requests).toHaveLength(3);
    await expectOneWindow(h, telegramId, user.id);

    // 3: typed, wrong: graded by the model, first sighting of the pattern.
    await h.say(telegramId, "I bought car");
    await expectOneWindow(h, telegramId, user.id);
    const wrong = feedback(h, telegramId).text;
    expect(wrong).toContain("❌ Not quite.");
    expect(wrong).toContain("Correct answer: I bought a car.");
    expect(wrong).toContain("🟠 Severity: moderate");
    expect(wrong).not.toContain("Review");
    const afterFirst = await database.db
      .select()
      .from(mistakes)
      .where(eq(mistakes.userId, user.id));
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({
      category: "grammar",
      pattern: "missing article before singular noun",
      exampleWrong: "I bought car",
      exampleRight: "I bought a car.",
      count: 1,
      cardId: null,
    });
    // The learner's words reach the grader as data in the user message, never in the system prompt.
    const checks = requests.filter((r) => r.messages.at(-1)?.content.includes("learner_answer"));
    expect(checks).toHaveLength(1);
    expect(checks[0]?.messages.at(-1)?.content).toContain("I bought car");
    expect(checks[0]?.system).not.toContain("I bought car");

    // 4: the same pattern again: the second sighting promotes it to a Review card.
    await h.say(telegramId, "He is engineer");
    expect(feedback(h, telegramId).text).toContain("This pattern keeps coming up");
    const [mistake] = await database.db.select().from(mistakes).where(eq(mistakes.userId, user.id));
    expect(mistake?.count).toBe(2);
    const userCards = await database.db.select().from(cards).where(eq(cards.userId, user.id));
    expect(userCards).toHaveLength(1);
    expect(userCards[0]).toMatchObject({
      itemType: "grammar_pattern",
      front: "missing article before singular noun",
      state: 0,
      id: mistake?.cardId,
    });

    // 5-10: correct choices end the session.
    for (let n = 5; n <= QUESTIONS_PER_SESSION; n++) await answer(h, telegramId, n, 0);

    // Stats: 10 answered, 8 right.
    const settings = await getSettings(database.db, user.id);
    const [stats] = await database.db
      .select()
      .from(dailyStats)
      .where(
        and(
          eq(dailyStats.userId, user.id),
          eq(dailyStats.date, localDate(new Date(), settings?.timezone ?? "UTC")),
        ),
      );
    expect(stats).toMatchObject({
      grammarAnswered: 10,
      grammarCorrect: 8,
      newWords: 0,
      reviews: 0,
    });

    // Cleanup: every session message is gone; the chat holds one fresh pinned hub with the summary.
    const [session] = await database.db
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.userId, user.id));
    expect(session).toMatchObject({
      status: "finished",
      summaryJson: {
        line: "Grammar: 8/10, weak: articles",
        correct: 8,
        total: 10,
        weak: "articles",
      },
    });
    const chat = [...h.telegram.chat(telegramId).values()];
    expect(chat).toHaveLength(1);
    expect(chat[0]?.text).toContain("Last session: Grammar: 8/10, weak: articles");
    expect(h.telegram.pinned.get(telegramId)).toBe(chat[0]?.id);
    expect(h.telegram.callsOf("deleteMessages").length).toBeGreaterThan(0);
  });

  test("a failing quiz call offers a retry; a failing check keeps the question open", async () => {
    const { h, telegramId, user, queue } = await setup([
      new LlmProviderError("server", "boom", 500),
      choice("modals"),
      typedItem("gap_fill", "modals", "You ___ (must) go.", ["must"]),
      new LlmProviderError("server", "boom", 500),
      wrongCheck("modal verb form", "must"),
    ]);

    const picker = await startGrammar(h, telegramId, user.id);
    await h.press(telegramId, picker.id, encodeGrammarCallback({ type: "topic", index: 5 }));
    const failed = lastBot(h, telegramId);
    expect(failed.text).toContain("could not prepare");
    expect(failed.buttons.flat()).toEqual([
      encodeGrammarCallback({ type: "retry" }),
      encodeGrammarCallback({ type: "stop" }),
    ]);

    await h.press(telegramId, failed.id, encodeGrammarCallback({ type: "retry" }));
    expect(lastBot(h, telegramId).text).toContain("Question 1 of 10");
    await answer(h, telegramId, 1, 0);

    // Question 2 is typed; the grader is down, so the question stays open and nothing is counted.
    await h.say(telegramId, "must to");
    const open = lastBot(h, telegramId).text;
    expect(open).toStartWith("⚠️ I could not check your answer");
    expect(open).toContain("Question 2 of 10");
    await expectOneWindow(h, telegramId, user.id);
    expect(
      await database.db.select().from(mistakes).where(eq(mistakes.userId, user.id)),
    ).toHaveLength(0);
    await h.say(telegramId, "must to");
    expect(feedback(h, telegramId).text).toContain("❌ Not quite.");
    expect(queue).toHaveLength(0);
  });

  test("a button of an earlier question does nothing", async () => {
    const { h, telegramId, user } = await setup([choice("modals"), choice("modals")]);
    const picker = await startGrammar(h, telegramId, user.id);
    await h.press(telegramId, picker.id, encodeGrammarCallback({ type: "topic", index: null }));
    const first = lastBot(h, telegramId);
    await answer(h, telegramId, 1, 0);
    const before = h.telegram.chat(telegramId).size;

    await h.press(
      telegramId,
      first.id,
      encodeGrammarCallback({ type: "answer", question: 1, option: 1 }),
    );
    expect(h.telegram.chat(telegramId).size).toBe(before);
    expect(lastBot(h, telegramId).text).toContain("Question 2 of 10");
  });
});
