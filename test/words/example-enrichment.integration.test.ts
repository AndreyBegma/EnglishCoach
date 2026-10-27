import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { type CreditedExample, type Word, wordEnrichments, words } from "../../src/db/schema";
import type { CompletionRequest, LlmProvider } from "../../src/llm/types";
import { createLogger } from "../../src/log";
import { ExampleCheckOutput, loadSkillRegistry, VocabEnrichBatchOutput } from "../../src/skills";
import { preferVerified, WordEnricher } from "../../src/words/enrichment";
import { importTatoeba, tatoebaSourcesFrom } from "../../src/words/tatoeba-import";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const FIXTURE_DIR = join(import.meta.dir, "../fixtures/tatoeba");
const A1 = "i a book from the opens at nine can you pen money be bad idea car yesterday";

type BatchWord = {
  id: number;
  lemma: string;
  example: string | null;
  given_examples: { en: string; translation: string }[];
};
type CheckItem = { index: number; lemma: string; en: string };

const taskOf = <T>(req: CompletionRequest<unknown>): T =>
  JSON.parse(
    (req.messages.at(-1)?.content ?? "").split("<task>\n")[1]?.split("\n</task>")[0] ?? "{}",
  ) as T;

/**
 * A model that follows the batch skill's rules (owner sentence, then the given ones, then its own)
 * and a checker that rejects every sentence with "wrong" in it.
 */
function mockModel() {
  const batches: BatchWord[][] = [];
  const checks: CheckItem[][] = [];
  const provider: LlmProvider = {
    kind: "server",
    async complete<T>(req: CompletionRequest<T>) {
      const skill: unknown = req.schema;
      if (skill === VocabEnrichBatchOutput) {
        const task = taskOf<{ words: BatchWord[] }>(req as CompletionRequest<unknown>);
        batches.push(task.words);
        const cards = task.words.map((word) => {
          const examples = [
            ...(word.example ? [{ en: word.example, translation: "перевод владельца" }] : []),
            ...word.given_examples,
            { en: `Model ${word.lemma} one.`, translation: "модель раз" },
            { en: `Model ${word.lemma} wrong two.`, translation: "модель два" },
          ].slice(0, 2);
          return {
            id: word.id,
            translation: `${word.lemma}-ru`,
            ipa: `/${word.lemma}/`,
            pos: "verb",
            examples,
            collocations: ["a", "b", "c"],
            mnemonic: "hook",
            image_query: null,
            emoji: "🙂",
          };
        });
        return { data: req.schema.parse({ cards }) };
      }
      if (skill === ExampleCheckOutput) {
        const { items } = taskOf<{ items: CheckItem[] }>(req as CompletionRequest<unknown>);
        checks.push(items);
        const results = items.map((item) => ({
          index: item.index,
          ok: !item.en.includes("wrong"),
          problem: item.en.includes("wrong") ? "ungrammatical" : null,
        }));
        return { data: req.schema.parse({ results }) };
      }
      throw new Error("unexpected skill call");
    },
  };
  return { provider, batches, checks };
}

describe.skipIf(!testServerUrl)("enrichment prefers verified examples", () => {
  let database: Database;
  let list: Word[];
  const model = mockModel();
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    await database.db.insert(words).values([
      ...A1.split(" ").map((lemma) => ({ lemma, pos: "", cefrLevel: "A1" as const, source: "d" })),
      { lemma: "borrow", pos: "verb", cefrLevel: "A2", source: "owner_list" },
      {
        lemma: "library",
        pos: "noun",
        cefrLevel: "A1",
        source: "owner_list",
        example: "The library opens at nine.",
      },
      { lemma: "zebra", pos: "noun", cefrLevel: "B1", source: "owner_list" },
    ]);
    await importTatoeba(database.db, tatoebaSourcesFrom(FIXTURE_DIR));
    list = await database.db
      .select()
      .from(words)
      .where(inArray(words.lemma, ["borrow", "library", "zebra"]))
      .orderBy(words.id);
    const enricher = new WordEnricher({
      db: database.db,
      registry: loadSkillRegistry(),
      provider: () => model.provider,
      log: createLogger({ level: "error" }),
    });
    expect(await enricher.enrich(list, "ru")).toBe(3);
  });
  afterAll(() => database.close());

  const examplesOf = async (lemma: string): Promise<CreditedExample[] | undefined> => {
    const word = list.find((entry) => entry.lemma === lemma);
    const [row] = await database.db
      .select({ data: wordEnrichments.data })
      .from(wordEnrichments)
      .where(eq(wordEnrichments.wordId, word?.id ?? 0));
    return row?.data.examples;
  };

  test("two Tatoeba sentences, unchanged and credited, given to the model to keep", async () => {
    expect(await examplesOf("borrow")).toEqual([
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
    const borrow = model.batches[0]?.find((word) => word.lemma === "borrow");
    expect(borrow?.given_examples.map((example) => example.en)).toEqual([
      "I borrowed a book from the library.",
      "Borrowing money is a bad idea.",
    ]);
  });

  test("the owner's sentence first, then one Tatoeba sentence", async () => {
    expect(await examplesOf("library")).toEqual([
      { en: "The library opens at nine.", translation: "перевод владельца" },
      {
        en: "I borrowed a book from the library.",
        translation: "Я взял книгу в библиотеке.",
        credit: { source: "tatoeba", id: 1, author: "alice" },
      },
    ]);
  });

  test("no verified sentence: the model writes them, and a rejected one is dropped", async () => {
    // Only the model's own sentences are checked, all in one call.
    expect(model.checks).toHaveLength(1);
    expect(model.checks[0]?.map((item) => item.en)).toEqual([
      "Model zebra one.",
      "Model zebra wrong two.",
    ]);
    expect(await examplesOf("zebra")).toEqual([
      { en: "Model zebra one.", translation: "модель раз" },
    ]);
  });
});

describe("the inline fallback", () => {
  test("puts verified examples before the model's, two in all", () => {
    const verified = {
      en: "Verified.",
      translation: "Проверено.",
      credit: { source: "tatoeba" as const, id: 9, author: null },
    };
    const one = { en: "One.", translation: "Раз." };
    const two = { en: "Two.", translation: "Два." };
    expect(preferVerified([one, two], [verified])).toEqual([verified, one]);
    expect(preferVerified([one, two], [])).toEqual([one, two]);
  });
});
