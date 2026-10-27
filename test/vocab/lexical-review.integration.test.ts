import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findUserByTelegramId, updateSettings } from "../../src/db/repositories/users";
import { type CardBack, cards, type LexicalDetails, reviewLogs, words } from "../../src/db/schema";
import { encodeVocabCallback, type VocabCallback } from "../../src/vocab/callbacks";
import { Scheduler } from "../../src/vocab/scheduler";
import { createHarness, type Harness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { vocabSkills } from "./fake-llm";

const DAY = 86_400_000;

describe.skipIf(!testServerUrl)("lexical units in Learn words and Review", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  let nextUser = 920_001;
  async function setup() {
    const telegramId = nextUser++;
    const llm = vocabSkills(database.db);
    const h = createHarness(database.db, { adminIds: [telegramId], skills: llm.skills });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    await updateSettings(database.db, user.id, {
      cefrLevel: "B1",
      wordsPerDay: 2,
      timezone: "UTC",
    });
    return { h, telegramId, user, llm };
  }

  const last = (h: Harness, telegramId: number) => {
    const message = [...h.telegram.chat(telegramId).values()]
      .filter((m) => m.from === "bot")
      .at(-1);
    if (!message) throw new Error("no bot message");
    return message;
  };
  const press = (h: Harness, telegramId: number, callback: VocabCallback) =>
    h.press(telegramId, last(h, telegramId).id, encodeVocabCallback(callback));
  async function open(
    h: Harness,
    telegramId: number,
    userId: number,
    activity: "learn" | "review",
  ) {
    const hub = await getHub(database.db, userId);
    if (!hub) throw new Error("no hub");
    await h.press(telegramId, hub.messageId, encodeCallback({ type: "activity", activity }));
  }

  test("Learn words: a picked phrasal verb becomes a phrasal_verb card carrying its particle", async () => {
    const details: LexicalDetails = { kind: "phrasal_verb", verb: "turn", particle: "up" };
    await database.db.insert(words).values({
      lemma: "turn up",
      pos: "phrasal verb",
      unitType: "phrasal_verb",
      details,
      cefrLevel: "B1",
      source: "test",
    });
    const { h, telegramId, user } = await setup();
    await open(h, telegramId, user.id, "learn");
    expect(last(h, telegramId).text).toContain("turn up-translation");

    const [card] = await database.db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.front, "turn up")));
    expect(card).toMatchObject({ itemType: "phrasal_verb", reps: 0 });
    expect(card?.backJson.unit).toEqual(details);

    // The first check is recognition for every unit type.
    await press(h, telegramId, { op: "got-it", cardId: card?.id ?? 0 });
    expect(last(h, telegramId).text).toContain("Pick the meaning.");
  });

  test("a mock Review with one item of each type: idiom, phrasal verb, collocation, word family", async () => {
    const { h, telegramId, user, llm } = await setup();
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
    const back = (front: string, unit?: LexicalDetails): CardBack => ({
      translation: `${front}-translation`,
      examples: [{ en: `An example with ${front}.`, translation: "x" }],
      ...(unit ? { unit } : {}),
    });
    const inserted = await database.db
      .insert(cards)
      .values([
        // Weak → recognition by buttons.
        {
          userId: user.id,
          itemType: "idiom" as const,
          front: "break the ice",
          backJson: back("break the ice"),
          ...reviewed(1, 5),
        },
        // Firmer → particle choice.
        {
          userId: user.id,
          itemType: "phrasal_verb" as const,
          front: "give up",
          backJson: back("give up", { kind: "phrasal_verb", verb: "give", particle: "up" }),
          ...reviewed(5, 4),
        },
        // Firmer → the partner word, typed.
        {
          userId: user.id,
          itemType: "collocation" as const,
          front: "make a decision",
          backJson: back("make a decision", { kind: "collocation", partner: "make" }),
          ...reviewed(5, 3),
        },
        // Firmer → transform; reps 3 over the three other forms rotates back to the first.
        {
          userId: user.id,
          itemType: "word_family" as const,
          front: "decide",
          backJson: back("decide", {
            kind: "word_family",
            forms: [
              { pos: "verb", form: "decide" },
              { pos: "noun", form: "decision" },
              { pos: "adjective", form: "decisive" },
              { pos: "adverb", form: "decisively" },
            ],
          }),
          ...reviewed(5, 2),
        },
        // Stable phrasal verb → a sentence of the learner's own, always judged by vocab-check.
        {
          userId: user.id,
          itemType: "phrasal_verb" as const,
          front: "set up",
          backJson: back("set up", { kind: "phrasal_verb", verb: "set", particle: "up" }),
          ...reviewed(12, 1),
        },
      ])
      .returning();
    const [idiom, giveUp, collocation, family, setUp] = inserted;
    if (!idiom || !giveUp || !collocation || !family || !setUp) throw new Error("not inserted");

    await open(h, telegramId, user.id, "review");
    expect(last(h, telegramId).text).toContain("5 cards to review");
    await press(h, telegramId, { op: "start" });

    // 1. Idiom: recognition.
    expect(last(h, telegramId).text).toContain("Pick the meaning.");
    await press(h, telegramId, { op: "choice", cardId: idiom.id, index: 0 });
    expect(last(h, telegramId).text).toContain("✅ Correct.");
    await press(h, telegramId, { op: "rate", cardId: idiom.id, rating: "good" });

    // 2. Phrasal verb: the particle, by buttons; the options are particles.
    const particle = last(h, telegramId);
    expect(particle.text).toContain("Pick the particle.");
    expect(particle.labels.flat()).toEqual(["up", "off", "away", "over"]);
    await press(h, telegramId, { op: "choice", cardId: giveUp.id, index: 1 });
    expect(last(h, telegramId).text).toContain("❌ The answer: <b>up</b>");
    await press(h, telegramId, { op: "rate", cardId: giveUp.id, rating: "again" });

    // 3. Collocation: type the partner word; exact, so no judge is called.
    expect(last(h, telegramId).text).toContain("Fill in the missing word.");
    await h.say(telegramId, "Make");
    expect(last(h, telegramId).text).toContain("✅ Correct.");
    await press(h, telegramId, { op: "rate", cardId: collocation.id, rating: "good" });

    // 4. Word family: transform to the form the server chose.
    expect(last(h, telegramId).text).toContain("(DECIDE)");
    await h.say(telegramId, "decision");
    expect(last(h, telegramId).text).toContain("✅ Correct.");
    await press(h, telegramId, { op: "rate", cardId: family.id, rating: "good" });

    // 5. Own sentence: even the bare phrase goes to the judge, which rejects it.
    expect(last(h, telegramId).text).toContain('Use "set up" in a sentence');
    llm.checks.push({
      verdict: "wrong",
      accepted_as: null,
      suggested_rating: "again",
      feedback: "That is the phrase, not a sentence.",
    });
    await h.say(telegramId, "set up");
    const judged = last(h, telegramId);
    expect(judged.text).toContain("That is the phrase, not a sentence.");
    expect(judged.labels[0]).toEqual(["✓ Again", "Hard", "Good", "Easy"]);
    await press(h, telegramId, { op: "rate", cardId: setUp.id, rating: "again" });

    const hub = await getHub(database.db, user.id);
    expect(h.telegram.chat(telegramId).get(hub?.messageId ?? -1)?.text).toContain(
      "5 reviewed · 60 %",
    );
    const logs = await database.db
      .select()
      .from(reviewLogs)
      .where(
        inArray(
          reviewLogs.cardId,
          inserted.map((card) => card.id),
        ),
      )
      .orderBy(asc(reviewLogs.id));
    expect(logs.map((log) => [log.cardId, log.rating])).toEqual([
      [idiom.id, 3],
      [giveUp.id, 1],
      [collocation.id, 3],
      [family.id, 3],
      [setUp.id, 1],
    ]);
    expect(llm.calls).toEqual({ enrich: 0, exercise: 5, check: 1 });
  });
});
