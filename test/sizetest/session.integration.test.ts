import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findUserByTelegramId, updateSettings } from "../../src/db/repositories/users";
import { learningSessions, vocabSizeTests, words } from "../../src/db/schema";
import { encodeSizeTestCallback, parseSizeTestCallback } from "../../src/sizetest/callbacks";
import { BANDS } from "../../src/sizetest/estimate";
import { PER_BAND, PSEUDO_ITEMS } from "../../src/sizetest/items";
import { createHarness, type Harness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

/** Words per band in the fixture: enough to sample from and to draw distractors. */
const FIXTURE_PER_BAND = PER_BAND + 2;
const lemma = (band: number, i: number) => `w${band}x${i}`;
const meaning = (band: number, i: number) => `m${band}x${i}`;

describe.skipIf(!testServerUrl)("size test session over a mocked Telegram API", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    const rows = [];
    for (let band = 1; band <= BANDS; band++) {
      for (let i = 0; i < FIXTURE_PER_BAND; i++) {
        rows.push({
          lemma: lemma(band, i),
          pos: "noun",
          cefrLevel: "B1" as const,
          frequencyRank: (band - 1) * 1000 + 1 + i * 100,
          source: "test",
          translationRu: meaning(band, i),
        });
      }
    }
    await database.db.insert(words).values(rows);
  });
  afterAll(() => database.close());

  let nextUser = 980_001;
  async function setup(explainLang: "ru" | "uk") {
    const telegramId = nextUser++;
    const h = createHarness(database.db, { adminIds: [telegramId] });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    await updateSettings(database.db, user.id, { cefrLevel: "B1", explainLang });
    const hub = await getHub(database.db, user.id);
    await h.press(
      telegramId,
      hub?.messageId ?? 0,
      encodeCallback({ type: "screen", screen: "main" }),
    );
    return { h, telegramId, user };
  }

  const lastBot = (h: Harness, telegramId: number) => {
    const last = [...h.telegram.chat(telegramId).values()].filter((m) => m.from === "bot").at(-1);
    if (!last) throw new Error("no bot message");
    return last;
  };

  const hubMessage = async (h: Harness, telegramId: number, userId: number) => {
    const hub = await getHub(database.db, userId);
    const message = h.telegram.chat(telegramId).get(hub?.messageId ?? -1);
    if (!message) throw new Error("no hub");
    return message;
  };

  const START = encodeSizeTestCallback({ type: "start" });

  test("a learner who knows the first three bands reads as ≈3000 and the run is stored", async () => {
    const { h, telegramId, user } = await setup("ru");

    const hub = await hubMessage(h, telegramId, user.id);
    expect(hub.buttons.flat()).toContain(START);
    await h.press(telegramId, hub.id, START);

    let asked = 0;
    for (;;) {
      const window = lastBot(h, telegramId);
      const answerRow = window.buttons.flat().map(parseSizeTestCallback);
      const first = answerRow.find((callback) => callback?.type === "answer");
      if (first?.type !== "answer") break;
      expect(first.item).toBe(asked);

      // Fluent wraps variables in bidi isolation marks.
      const text = window.text.replace(/[⁨⁩]/g, "");
      const shown = /<b>(.+?)<\/b>/.exec(text)?.[1] ?? "";
      const known = /^w([123])x(\d)$/.exec(shown);
      const right = known ? `m${known[1]}x${known[2]}` : undefined;
      const labels = window.labels.flat();
      const index = right ? labels.indexOf(right) : -1;
      const data =
        index >= 0
          ? (window.buttons.flat()[index] ?? "")
          : encodeSizeTestCallback({ type: "answer", item: asked, option: null });
      await h.press(telegramId, window.id, data);
      asked++;
      if (asked > 100) throw new Error("the test never ended");
    }

    expect(asked).toBe(BANDS * PER_BAND + PSEUDO_ITEMS);
    const [row] = await database.db
      .select()
      .from(vocabSizeTests)
      .where(eq(vocabSizeTests.userId, user.id));
    expect(row?.estimate).toBe(3000);
    expect(row?.falseAlarmsBp).toBe(0);
    expect(row?.answers).toHaveLength(asked);
    expect(row?.coverageBp).toBeGreaterThan(8800);
    expect(row?.coverageBp).toBeLessThan(9400);

    const [session] = await database.db
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.userId, user.id));
    expect(session?.kind).toBe("size_test");
    expect(session?.status).toBe("finished");

    // The session cleaned up: only the hub is left, with the result folded in and no offer.
    const after = await hubMessage(h, telegramId, user.id);
    expect([...h.telegram.chat(telegramId).values()].map((m) => m.id)).toEqual([after.id]);
    expect(after.text).toContain("%");
    expect(after.buttons.flat()).not.toContain(START);

    // Progress shows the size and the vocabulary suffix; the monthly offer is not due.
    await h.press(telegramId, after.id, encodeCallback({ type: "screen", screen: "progress" }));
    const progress = await hubMessage(h, telegramId, user.id);
    expect(progress.text).toContain("📏");
    expect(progress.buttons.flat()).not.toContain(START);
  });

  test("a tap on an earlier item is already answered and changes nothing", async () => {
    const { h, telegramId, user } = await setup("ru");
    const hub = await hubMessage(h, telegramId, user.id);
    await h.press(telegramId, hub.id, START);
    const window = lastBot(h, telegramId);
    const skip = encodeSizeTestCallback({ type: "answer", item: 0, option: null });
    await h.press(telegramId, window.id, skip);
    await h.press(telegramId, window.id, skip);
    const next = lastBot(h, telegramId);
    const items = next.buttons
      .flat()
      .map(parseSizeTestCallback)
      .flatMap((callback) => (callback?.type === "answer" ? [callback.item] : []));
    expect(new Set(items)).toEqual(new Set([1]));

    // Stop ends the test without a trace.
    await h.press(telegramId, next.id, encodeSizeTestCallback({ type: "stop" }));
    const stored = await database.db
      .select()
      .from(vocabSizeTests)
      .where(eq(vocabSizeTests.userId, user.id));
    expect(stored).toEqual([]);
  });

  test("with no meanings in the learner's language the test is not run", async () => {
    const { h, telegramId, user } = await setup("uk");
    const hub = await hubMessage(h, telegramId, user.id);
    await h.press(telegramId, hub.id, START);
    const [session] = await database.db
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.userId, user.id));
    expect(session?.status).toBe("finished");
    const stored = await database.db
      .select()
      .from(vocabSizeTests)
      .where(eq(vocabSizeTests.userId, user.id));
    expect(stored).toEqual([]);
  });
});
