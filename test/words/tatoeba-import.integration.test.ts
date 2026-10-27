import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { verifiedExamples } from "../../src/db/repositories/examples";
import { exampleSentences, exampleSentenceWords, words } from "../../src/db/schema";
import { DEFAULT_FILTER } from "../../src/words/tatoeba";
import { importTatoeba, tatoebaSourcesFrom } from "../../src/words/tatoeba-import";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const FIXTURE_DIR = join(import.meta.dir, "../fixtures/tatoeba");
const A1 =
  "i a book from the library can you pen money be bad idea car yesterday we look after child";
const sources = () => tatoebaSourcesFrom(FIXTURE_DIR);

describe.skipIf(!testServerUrl)("importTatoeba", () => {
  let database: Database;
  let borrowId: number;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    await database.db.insert(words).values([
      ...A1.split(" ").map((lemma) => ({
        lemma,
        pos: "",
        cefrLevel: "A1" as const,
        source: "test",
      })),
      { lemma: "borrow", pos: "verb", cefrLevel: "A2", source: "test" },
    ]);
    const [borrow] = await database.db
      .select({ id: words.id })
      .from(words)
      .where(eq(words.lemma, "borrow"));
    borrowId = borrow?.id ?? 0;
  });
  afterAll(() => database.close());

  const sentenceIds = async () =>
    (
      await database.db
        .select({ id: exampleSentences.id, sourceId: exampleSentences.sourceId })
        .from(exampleSentences)
        .orderBy(exampleSentences.sourceId)
    ).map((row) => `${row.sourceId}:${row.id}`);

  test("imports the fixture's sentences with their translations and lemma links", async () => {
    const result = await importTatoeba(database.db, sources());
    expect(result).toMatchObject({
      scanned: 7,
      passed: 5,
      sentences: 5,
      inserted: 5,
      removed: 0,
    });
    const [first] = await database.db
      .select()
      .from(exampleSentences)
      .where(eq(exampleSentences.sourceId, 1));
    expect(first).toMatchObject({
      source: "tatoeba",
      text: "I borrowed a book from the library.",
      cefrLevel: "A2",
      wordCount: 7,
      author: "alice",
      translations: {
        ru: { id: 101, text: "Я взял книгу в библиотеке.", author: "dasha" },
        uk: { id: 201, text: "Я взяв книжку в бібліотеці.", author: "oksana" },
      },
    });
    const links = await database.db
      .select()
      .from(exampleSentenceWords)
      .where(eq(exampleSentenceWords.wordId, borrowId));
    expect(links).toHaveLength(4);
  });

  test("is idempotent: a rerun changes no row and keeps the ids", async () => {
    const before = await sentenceIds();
    const result = await importTatoeba(database.db, sources());
    expect(result).toMatchObject({ sentences: 5, inserted: 0, removed: 0 });
    expect(await sentenceIds()).toEqual(before);
  });

  test("the best two per word and language, with the Tatoeba credit; none for English", async () => {
    const ru = (await verifiedExamples(database.db, [borrowId], "ru")).get(borrowId);
    // Sentence 1 (7 words) and 3 (6 words) are nearest a card's 8 words.
    expect(ru).toEqual([
      {
        en: "I borrowed a book from the library.",
        translation: "Я взял книгу в библиотеке.",
        credit: { source: "tatoeba", id: 1, author: "alice" },
      },
      {
        en: "Borrowing money is a bad idea.",
        translation: "Брать деньги в долг — плохая идея.",
        credit: { source: "tatoeba", id: 3, author: null },
      },
    ]);
    // Sentence 3 has no Ukrainian translation; 2 and 6 tie on length, the lower id wins.
    const uk = (await verifiedExamples(database.db, [borrowId], "uk")).get(borrowId);
    expect(uk?.map((example) => example.credit?.id)).toEqual([1, 2]);
    expect((await verifiedExamples(database.db, [borrowId], "en")).size).toBe(0);
  });

  test("a sentence the filters no longer choose is removed with its links", async () => {
    const result = await importTatoeba(database.db, sources(), { ...DEFAULT_FILTER, maxWords: 5 });
    // Sentences 1 (7 words) and 3 (6 words) go.
    expect(result).toMatchObject({ sentences: 3, inserted: 0, removed: 2 });
    expect((await sentenceIds()).map((id) => id.split(":")[0])).toEqual(["2", "6", "8"]);
    const ru = (await verifiedExamples(database.db, [borrowId], "ru")).get(borrowId);
    expect(ru?.map((example) => example.credit?.id)).toEqual([2, 6]);
  });
});
