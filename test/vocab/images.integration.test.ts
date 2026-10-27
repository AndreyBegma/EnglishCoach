import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { getWordImage } from "../../src/db/repositories/images";
import { findActiveSession } from "../../src/db/repositories/sessions";
import { findUserByTelegramId, updateSettings } from "../../src/db/repositories/users";
import { wordImages, words } from "../../src/db/schema";
import { createWordImages, type WordImages } from "../../src/images";
import { createLogger } from "../../src/log";
import { loadSkillRegistry } from "../../src/skills";
import { encodeVocabCallback, type VocabCallback } from "../../src/vocab/callbacks";
import { WordEnricher } from "../../src/words/enrichment";
import { createHarness, type Harness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { FakeStock, PEXELS_KEY, UNSPLASH_KEY } from "../images/fake-stock";
import { vocabSkills } from "./fake-llm";

describe.skipIf(!testServerUrl)("Learn words with pictures, over a mocked Telegram API", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    await database.db.insert(words).values(
      ["decide", "borrow"].map((lemma, rank) => ({
        lemma,
        pos: "verb",
        cefrLevel: "A2" as const,
        frequencyRank: rank + 1,
        source: "test",
      })),
    );
  });
  afterAll(() => database.close());
  // Pictures are per word and shared: each test starts with none stored.
  beforeEach(async () => {
    await database.db.delete(wordImages);
  });

  function pictures() {
    const stock = new FakeStock();
    const images = createWordImages(
      { PEXELS_API_KEY: PEXELS_KEY, UNSPLASH_ACCESS_KEY: UNSPLASH_KEY },
      { db: database.db, log: createLogger({ level: "error" }) },
      stock.fetch,
    );
    if (!images) throw new Error("no images");
    return { stock, images };
  }

  let nextUser = 960_001;
  async function setup(images?: WordImages) {
    const telegramId = nextUser++;
    const llm = vocabSkills(database.db);
    const h = createHarness(database.db, { adminIds: [telegramId], skills: llm.skills, images });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    await updateSettings(database.db, user.id, {
      cefrLevel: "A2",
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

  async function learn(h: Harness, telegramId: number, userId: number) {
    const hub = await getHub(database.db, userId);
    await h.press(
      telegramId,
      hub?.messageId ?? -1,
      encodeCallback({ type: "activity", activity: "learn" }),
    );
    return last(h, telegramId);
  }

  async function chatIds(h: Harness, telegramId: number, userId: number) {
    await h.sessions.flushNotes();
    const hub = await getHub(database.db, userId);
    return { hub: hub?.messageId ?? -1, ids: [...h.telegram.chat(telegramId).keys()] };
  }

  const cardIdOf = (callbackData: string) => Number(callbackData.split(":").at(-1));

  test("a new word is one photo; another picture swaps it in place; cleanup removes it", async () => {
    const { stock, images } = pictures();
    const { h, telegramId, user } = await setup(images);

    const card = await learn(h, telegramId, user.id);
    expect(card.photo).toBe("https://images.pexels.com/decide-scene-1.jpg");
    expect(card.text).toContain("<b>decide</b> /decide/");
    expect(card.text).toContain("decide-translation");
    expect(card.text).toContain("• I decide every day.");
    expect(card.text).toContain('📷 <a href="https://www.pexels.com/@author1">Pexels Author 1</a>');
    expect(card.labels.flat()).toContain("🔄 Another picture");
    let { hub, ids } = await chatIds(h, telegramId, user.id);
    expect(ids).toEqual([hub, card.id]);

    const cardId = cardIdOf(card.buttons[0]?.[0] ?? "");
    await press(h, telegramId, { op: "next-image", cardId });
    const swapped = last(h, telegramId);
    // editMessageMedia: the same message, a new photo and credit.
    expect(swapped.id).toBe(card.id);
    expect(swapped.photo).toBe("https://images.pexels.com/decide-scene-2.jpg");
    expect(swapped.text).toContain("Pexels Author 2");
    expect(swapped.labels.flat()).toContain("🔄 Another picture");
    ({ hub, ids } = await chatIds(h, telegramId, user.id));
    expect(ids).toEqual([hub, card.id]);
    const word = await database.db.query.words.findFirst({
      where: (w, { eq }) => eq(w.lemma, "decide"),
    });
    expect(await getWordImage(database.db, word?.id ?? -1)).toMatchObject({ resultIndex: 1 });

    // The check is text: a new window replaces the photo.
    await press(h, telegramId, { op: "got-it", cardId });
    const check = last(h, telegramId);
    expect(check.photo).toBeUndefined();
    ({ hub, ids } = await chatIds(h, telegramId, user.id));
    expect(ids).toEqual([hub, check.id]);

    await press(h, telegramId, { op: "finish" });
    ({ hub, ids } = await chatIds(h, telegramId, user.id));
    expect(ids).toEqual([hub]);
    expect(await findActiveSession(database.db, user.id)).toBeUndefined();
    expect(stock.count("api.unsplash.com")).toBe(0);
  });

  test("the picture is fetched once: a second learner's card makes no HTTP call", async () => {
    const { stock, images } = pictures();
    const first = await setup(images);
    await learn(first.h, first.telegramId, first.user.id);
    const calls = stock.calls.length;
    expect(calls).toBeGreaterThan(0);

    const second = await setup(images);
    const card = await learn(second.h, second.telegramId, second.user.id);
    expect(card.photo).toBe("https://images.pexels.com/decide-scene-1.jpg");
    expect(stock.calls.length).toBe(calls);
  });

  test("an image error falls back to the text card, without the picture button", async () => {
    const { stock, images } = pictures();
    stock.pexels = "error";
    stock.unsplash = "down";
    const { h, telegramId, user } = await setup(images);
    const card = await learn(h, telegramId, user.id);
    expect(card.photo).toBeUndefined();
    expect(card.text).toContain("decide-translation");
    expect(card.labels.flat()).not.toContain("🔄 Another picture");
    expect(h.logs.join("\n")).not.toContain(PEXELS_KEY);
  });

  test("no keys: the card is the text card of today", async () => {
    const { h, telegramId, user } = await setup();
    const card = await learn(h, telegramId, user.id);
    expect(card.photo).toBeUndefined();
    expect(card.labels.flat()).not.toContain("🔄 Another picture");
  });

  test("results run out: a note says so and the photo stays", async () => {
    const { stock, images } = pictures();
    stock.unsplash = "empty";
    const { h, telegramId, user } = await setup(images);
    const card = await learn(h, telegramId, user.id);
    const cardId = cardIdOf(card.buttons[0]?.[0] ?? "");
    for (let i = 0; i < 2; i++) await press(h, telegramId, { op: "next-image", cardId });
    expect(last(h, telegramId).photo).toBe("https://images.pexels.com/decide-scene-3.jpg");

    await h.press(telegramId, card.id, encodeVocabCallback({ op: "next-image", cardId }));
    expect(last(h, telegramId).text).toBe("No other picture for this word.");
    const kept = h.telegram.chat(telegramId).get(card.id);
    expect(kept?.photo).toBe("https://images.pexels.com/decide-scene-3.jpg");
    // The answer lock stripped the buttons while it worked; the card has them back, unmarked.
    expect(kept?.labels.flat()).toContain("🔄 Another picture");
    expect(kept?.text).toContain("<b>decide</b>");
    expect(kept?.text).not.toContain("Preparing");
  });

  test("prefetch fetches the pictures of upcoming words too", async () => {
    const { stock, images } = pictures();
    const { user, llm } = await setup();
    const enricher = new WordEnricher({
      db: database.db,
      registry: loadSkillRegistry(),
      provider: () => llm.provider,
      log: createLogger({ level: "error" }),
      prefetchDays: 1,
      images,
    });
    await enricher.prefetchUser(user.id);
    const prefetched = await database.db.select().from(wordImages);
    expect(prefetched.map((row) => row.query).sort()).toEqual(["borrow picture", "decide picture"]);
    expect(stock.count("api.pexels.com")).toBe(2);
  });
});
