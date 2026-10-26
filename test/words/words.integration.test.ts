import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { createEmptyCard } from "ts-fsrs";
import type { Database } from "../../src/db/client";
import { fsrsCardToColumns } from "../../src/db/fsrs";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { type CefrLevel, cards, words } from "../../src/db/schema";
import { WordPicker } from "../../src/words/picker";
import { seedWords, type WordRow } from "../../src/words/seed";
import { createTestDatabase, testServerUrl } from "../db/test-database";

function row(lemma: string, cefrLevel: CefrLevel, frequencyRank: number | null): WordRow {
  return { lemma, pos: "noun", cefrLevel, frequencyRank };
}

// 10 B1 words (b01 most frequent … b10), 4 B2 words, one unranked B1 word.
const fixture: WordRow[] = [
  ...Array.from({ length: 10 }, (_, i) => row(`b${String(i + 1).padStart(2, "0")}`, "B1", i + 1)),
  row("b-unranked", "B1", null),
  ...Array.from({ length: 4 }, (_, i) => row(`c${i + 1}`, "B2", 100 + i)),
];

describe.skipIf(!testServerUrl)("words seed and picker", () => {
  let database: Database;
  let picker: WordPicker;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    picker = new WordPicker(database.db);
    await seedWords(database.db, fixture);
  });
  afterAll(() => database.close());

  const lemmas = (list: { lemma: string }[]) => list.map((word) => word.lemma);

  async function ownCard(userId: number, lemma: string) {
    const [word] = await database.db.select().from(words).where(eq(words.lemma, lemma));
    if (!word) throw new Error(`no word ${lemma}`);
    await database.db.insert(cards).values({
      userId,
      itemType: "word",
      wordId: word.id,
      front: lemma,
      ...fsrsCardToColumns(createEmptyCard(new Date("2026-10-01T00:00:00Z"))),
    });
  }

  test("seeding twice leaves no duplicates and applies changes", async () => {
    const total = async () => (await database.db.select({ n: count() }).from(words))[0]?.n;
    expect(await total()).toBe(fixture.length);

    await seedWords(database.db, [row("b01", "A2", 1), ...fixture.slice(1)]);
    expect(await total()).toBe(fixture.length);
    const [b01] = await database.db.select().from(words).where(eq(words.lemma, "b01"));
    expect(b01?.cefrLevel).toBe("A2");

    await seedWords(database.db, fixture);
    const [restored] = await database.db.select().from(words).where(eq(words.lemma, "b01"));
    expect(restored?.cefrLevel).toBe("B1");
  });

  test("mixes floor(20 %) from the level above, each tier by frequency", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 5001 });

    expect(lemmas(await picker.pickNew(user.id, "B1", 5))).toEqual([
      "b01",
      "b02",
      "b03",
      "b04",
      "c1",
    ]);
    expect(lemmas(await picker.pickNew(user.id, "B1", 4))).toEqual(["b01", "b02", "b03", "b04"]);
    expect(await picker.pickNew(user.id, "B1", 0)).toEqual([]);
  });

  test("is deterministic", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 5002 });
    expect(await picker.pickNew(user.id, "B1", 5)).toEqual(await picker.pickNew(user.id, "B1", 5));
  });

  test("never returns a word the user already has, but ignores other users' cards", async () => {
    const owner = await getOrCreateUser(database.db, { telegramId: 5003 });
    const other = await getOrCreateUser(database.db, { telegramId: 5004 });
    await ownCard(owner.id, "b01");
    await ownCard(owner.id, "b02");
    await ownCard(owner.id, "c1");

    expect(lemmas(await picker.pickNew(owner.id, "B1", 5))).toEqual([
      "b03",
      "b04",
      "b05",
      "b06",
      "c2",
    ]);
    expect(lemmas(await picker.pickNew(other.id, "B1", 2))).toEqual(["b01", "b02"]);
  });

  test("tops up from the learner's level when the level above is exhausted", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 5005 });
    for (const lemma of ["c1", "c2", "c3", "c4"]) await ownCard(user.id, lemma);

    expect(lemmas(await picker.pickNew(user.id, "B1", 5))).toEqual([
      "b01",
      "b02",
      "b03",
      "b04",
      "b05",
    ]);
  });

  test("tops up from the level above when the learner's level is exhausted, unranked last", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 5006 });
    for (let i = 3; i <= 10; i++) await ownCard(user.id, `b${String(i).padStart(2, "0")}`);

    // Left at B1: b01, b02, b-unranked. Asking for 5: quota 1 above, 4 at B1 -> only 3 exist.
    expect(lemmas(await picker.pickNew(user.id, "B1", 5))).toEqual([
      "b01",
      "b02",
      "b-unranked",
      "c1",
      "c2",
    ]);
  });

  test("returns fewer than n only when everything is taken, and nothing above C2", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 5007 });
    expect((await picker.pickNew(user.id, "B2", 50)).length).toBe(4);
    expect(await picker.pickNew(user.id, "C2", 5)).toEqual([]);
  });
});
