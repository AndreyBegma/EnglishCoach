import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { findUnseenWords, randomLemmas } from "../../src/db/repositories/words";
import { words } from "../../src/db/schema";
import { type LexicalData, OWNER_PHRASAL_SOURCE, seedLexicalUnits } from "../../src/words/lexical";
import { WordPicker } from "../../src/words/picker";
import { seedWords, type WordRow } from "../../src/words/seed";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const dictionary = new Set(["give", "take", "make", "decide"]);
const owner = [
  { number: 1, phrase: "give up", translationRu: "сдаться", example: "Never give up.", planDay: 1 },
];

const data: LexicalData = {
  phrasalVerbs: [
    { phrase: "give up", verb: "give", particle: "up", level: "B1" },
    { phrase: "take off", verb: "take", particle: "off", level: "B1" },
    { phrase: "take on", verb: "take", particle: "on", level: "B2" },
  ],
  collocations: [
    { phrase: "make a decision", partner: "make", level: "B1" },
    { phrase: "take a break", partner: "take", level: "A2" },
  ],
  idioms: [
    { phrase: "break the ice", level: "B2" },
    { phrase: "spill the beans", level: "C1" },
  ],
  wordFamilies: [
    {
      lemma: "decide",
      level: "B1",
      forms: [
        ["verb", "decide"],
        ["noun", "decision"],
      ],
    },
  ],
};

const dictionaryWords: WordRow[] = [
  ...Array.from({ length: 6 }, (_, i) => ({
    lemma: `b${i + 1}`,
    pos: "noun",
    cefrLevel: "B1" as const,
    frequencyRank: i + 1,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    lemma: `c${i + 1}`,
    pos: "noun",
    cefrLevel: "B2" as const,
    frequencyRank: 100 + i,
  })),
  { lemma: "decide", pos: "verb", cefrLevel: "B1", frequencyRank: 50 },
];

describe.skipIf(!testServerUrl)("lexical units: seed and picker", () => {
  let database: Database;
  let picker: WordPicker;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    picker = new WordPicker(database.db);
    await seedWords(database.db, dictionaryWords);
    await seedLexicalUnits(database.db, data, dictionary, owner);
  });
  afterAll(() => database.close());

  test("units are words rows of their type; seeding twice adds nothing", async () => {
    const total = async () => (await database.db.select({ n: count() }).from(words))[0]?.n;
    const before = await total();
    await seedLexicalUnits(database.db, data, dictionary, owner);
    expect(await total()).toBe(before);

    const [giveUp] = await database.db.select().from(words).where(eq(words.lemma, "give up"));
    expect(giveUp).toMatchObject({
      unitType: "phrasal_verb",
      pos: "phrasal verb",
      source: OWNER_PHRASAL_SOURCE,
      translationRu: "сдаться",
      details: { kind: "phrasal_verb", verb: "give", particle: "up" },
    });
    const decide = await database.db.select().from(words).where(eq(words.lemma, "decide"));
    expect(decide.map((row) => row.unitType).sort()).toEqual(["word", "word_family"]);
  });

  test("a failing check loads nothing", async () => {
    const bad = { ...data, idioms: [{ phrase: "piece of cake", level: "A2" as const }] };
    expect(seedLexicalUnits(database.db, bad, dictionary, owner)).rejects.toThrow(/below B2/);
    const rows = await database.db.select().from(words).where(eq(words.lemma, "piece of cake"));
    expect(rows).toEqual([]);
  });

  test("the word tier and distractors keep to single words", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 8801 });
    const b1 = await findUnseenWords(database.db, user.id, "B1", 50);
    expect(b1.every((word) => word.unitType === "word")).toBe(true);
    expect(await randomLemmas(database.db, "B1", "give up", 10, "phrasal_verb")).toEqual([
      "take off",
    ]);
  });

  test("a B1 learner gets every unit type but idioms, even with B2 idioms one level up", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 8802 });
    const picked = await picker.pickNew(user.id, "B1", 20);
    const types = new Set(picked.map((word) => word.unitType));
    expect(types).toEqual(new Set(["word", "collocation", "phrasal_verb", "word_family"]));
    // One at a time Learn words meets the same mix; only the words' level-up order differs.
    const upcoming = await picker.upcoming(user.id, "B1", 20);
    expect(upcoming.map((word) => word.unitType)).toEqual(picked.map((word) => word.unitType));
  });

  test("a B2 learner gets idioms", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 8803 });
    const picked = await picker.pickNew(user.id, "B2", 20);
    expect(picked.filter((word) => word.unitType === "idiom").map((word) => word.lemma)).toEqual([
      "break the ice",
      "spill the beans",
    ]);
  });
});
