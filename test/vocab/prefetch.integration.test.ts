import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findUserByTelegramId, updateSettings } from "../../src/db/repositories/users";
import { cards, wordEnrichments, words } from "../../src/db/schema";
import { createLogger } from "../../src/log";
import { loadSkillRegistry } from "../../src/skills";
import { WordEnricher } from "../../src/words/enrichment";
import { createHarness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { vocabSkills } from "./fake-llm";

// Eight A2 owner words in curriculum order; the first carries the owner's example.
const LEMMAS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

describe.skipIf(!testServerUrl)("word prefetch fills the shared cache ahead of Learn words", () => {
  let database: Database;
  const registry = loadSkillRegistry();
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    await database.db.insert(words).values(
      LEMMAS.map((lemma, index) => ({
        lemma,
        pos: "verb",
        cefrLevel: "A2" as const,
        source: "owner_list",
        ipa: `/${lemma}-owner/`,
        translationRu: `${lemma}-ru`,
        example: index === 0 ? `The owner's ${lemma} sentence.` : null,
        curriculumStage: 0,
        curriculumIndex: index + 1,
      })),
    );
  });
  afterAll(() => database.close());

  const FIRST_USER = 940_001;
  let nextUser = FIRST_USER;
  async function setup(explainLang: "ru" | "uk" | "en", wordsPerDay = 2) {
    const telegramId = nextUser++;
    const llm = vocabSkills(database.db);
    const h = createHarness(database.db, { adminIds: [telegramId], skills: llm.skills });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    await updateSettings(database.db, user.id, {
      cefrLevel: "A2",
      wordsPerDay,
      timezone: "UTC",
      explainLang,
    });
    const enricher = new WordEnricher({
      db: database.db,
      registry,
      provider: () => llm.provider,
      log: createLogger({ level: "error" }),
      batchSize: 4,
      prefetchDays: 3,
      // The harness makes each test user an admin by env, as production does.
      adminTelegramIds: Array.from({ length: nextUser - FIRST_USER }, (_, i) => FIRST_USER + i),
    });
    return { h, telegramId, user, llm, enricher };
  }

  const cached = async (lang: "ru" | "uk" | "en") => {
    const rows = await database.db
      .select({ lemma: words.lemma, data: wordEnrichments.data })
      .from(wordEnrichments)
      .innerJoin(words, eq(words.id, wordEnrichments.wordId))
      .where(eq(wordEnrichments.lang, lang));
    return new Map(rows.map((row) => [row.lemma, row.data]));
  };

  test("the next 3 days × words per day are enriched, several words per call", async () => {
    const { user, llm, enricher } = await setup("ru");
    expect(await enricher.prefetchUser(user.id)).toBe(6);
    expect(llm.batch).toEqual({ calls: 2, words: 6 });
    expect(llm.calls.enrich).toBe(0);

    const ru = await cached("ru");
    expect([...ru.keys()].sort()).toEqual(LEMMAS.slice(0, 6));
    // The owner's fields win over the model's: Russian translation, IPA, and the first example.
    expect(ru.get("alpha")).toEqual({
      translation: "alpha-ru",
      ipa: "/alpha-owner/",
      pos: "verb",
      examples: [
        { en: "The owner's alpha sentence.", translation: "first translated" },
        { en: "Model sentence two with alpha.", translation: "second translated" },
      ],
      collocations: ["alpha a", "alpha b", "alpha c"],
      mnemonic: "Cached hook for alpha.",
      imageQuery: "alpha picture",
      emoji: null,
    });

    // Already cached: a second run makes no LLM call.
    expect(await enricher.prefetchUser(user.id)).toBe(0);
    expect(llm.batch.calls).toBe(2);
  });

  test("the cache is per language: Ukrainian gets the model's translation", async () => {
    const { user, llm, enricher } = await setup("uk", 1);
    expect(await enricher.prefetchUser(user.id)).toBe(3);
    expect(llm.batch.calls).toBe(1);
    expect((await cached("uk")).get("alpha")).toMatchObject({
      translation: "alpha-cached",
      ipa: "/alpha-owner/",
    });
  });

  test("a Learn session after prefetch makes zero LLM calls for its cards", async () => {
    const { h, telegramId, user, llm, enricher } = await setup("ru", 2);
    await enricher.prefetchUser(user.id);
    const batchCalls = llm.batch.calls;

    const hub = await getHub(database.db, user.id);
    await h.press(
      telegramId,
      hub?.messageId ?? -1,
      encodeCallback({ type: "activity", activity: "learn" }),
    );
    const shown = [...h.telegram.chat(telegramId).values()].filter((m) => m.from === "bot").at(-1);
    expect(shown?.text).toContain("alpha");
    expect(shown?.text).toContain("alpha-ru");
    expect(shown?.text).toContain("The owner's alpha sentence.");
    expect(llm.calls.enrich).toBe(0);
    expect(llm.batch.calls).toBe(batchCalls);

    const [card] = await database.db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, user.id), eq(cards.front, "alpha")));
    expect(card?.backJson).toMatchObject({
      translation: "alpha-ru",
      mnemonic: "Cached hook for alpha.",
    });
    expect(h.logs.some((line) => line.includes("vocab.enrich.cache_miss"))).toBe(false);
  });

  test("a cache miss falls back to inline enrichment and is logged as a metric", async () => {
    const { h, telegramId, user, llm } = await setup("en", 1);
    const hub = await getHub(database.db, user.id);
    await h.press(
      telegramId,
      hub?.messageId ?? -1,
      encodeCallback({ type: "activity", activity: "learn" }),
    );
    expect(llm.calls.enrich).toBe(1);
    expect(h.logs.some((line) => line.includes("vocab.enrich.cache_miss"))).toBe(true);
  });

  test("backfill enriches the rest of the list for the languages in use", async () => {
    const { enricher } = await setup("ru");
    await enricher.backfill(50);
    expect([...(await cached("ru")).keys()].sort()).toEqual(LEMMAS);
    expect([...(await cached("uk")).keys()].sort()).toEqual(LEMMAS);
  });
});
