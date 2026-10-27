import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { CefrLevel } from "../../src/db/schema";
import {
  baseForms,
  buildTatoebaExamples,
  type DictionaryWord,
  LemmaIndex,
  parseLinkLine,
  parseSentenceLine,
  tokenize,
} from "../../src/words/tatoeba";
import { tatoebaSourcesFrom } from "../../src/words/tatoeba-import";

const FIXTURE_DIR = join(import.meta.dir, "../fixtures/tatoeba");

const A1 =
  "i a book from the library can you pen money be bad idea car yesterday we look after child it";
let nextId = 1;
const entry = (lemma: string, cefrLevel: CefrLevel): DictionaryWord => ({
  id: nextId++,
  lemma,
  cefrLevel,
});
const dictionary = [
  ...A1.split(" ").map((lemma) => entry(lemma, "A1")),
  entry("borrow", "A2"),
  entry("look after", "B1"),
];
const idOf = (lemma: string) => dictionary.find((word) => word.lemma === lemma)?.id ?? 0;

describe("Tatoeba export lines", () => {
  test("a detailed sentence line, an orphan's author is null", () => {
    expect(parseSentenceLine("3\teng\tHi there.\t\\N\t2010\t2010")).toEqual({
      id: 3,
      text: "Hi there.",
      author: null,
    });
    expect(parseSentenceLine("3\teng\tHi there.\tbob\t2010\t2010")?.author).toBe("bob");
    expect(parseSentenceLine("3\teng\tHi there.")?.author).toBeNull();
    expect(parseSentenceLine("x\teng\tHi")).toBeUndefined();
    expect(parseSentenceLine("")).toBeUndefined();
  });

  test("a link line", () => {
    expect(parseLinkLine("1\t101")).toEqual([1, 101]);
    expect(parseLinkLine("1")).toBeUndefined();
  });
});

describe("matching sentences to dictionary lemmas", () => {
  test("contractions are split, possessives dropped, capitals other than I may be names", () => {
    expect(tokenize("I don't think Tom's car is here.")).toEqual([
      { text: "i", name: false },
      { text: "do", name: false },
      { text: "not", name: false },
      { text: "think", name: false },
      { text: "tom", name: true },
      { text: "car", name: false },
      { text: "is", name: false },
      { text: "here", name: false },
    ]);
  });

  test("inflections reach their base form", () => {
    expect(baseForms("borrowed")).toContain("borrow");
    expect(baseForms("stopping")).toContain("stop");
    expect(baseForms("making")).toContain("make");
    expect(baseForms("studies")).toContain("study");
    expect(baseForms("children")).toContain("child");
    expect(baseForms("was")).toContain("be");
  });

  test("a phrase is shown instead of its first word, and raises the level", () => {
    const index = new LemmaIndex(dictionary);
    const match = index.match("We look after the children.");
    const lemmas = match.words.map((word) => word.lemma);
    expect(lemmas).toContain("look after");
    expect(lemmas).not.toContain("look");
    expect(match).toMatchObject({ level: "B1", unknown: 0 });
  });

  test("the level is the highest word's; names are not unknown words", () => {
    const index = new LemmaIndex(dictionary);
    expect(index.match("Tom borrowed my car yesterday.")).toMatchObject({
      level: "A2",
      unknown: 0,
    });
    expect(index.match("The quixotic cat.").unknown).toBe(2);
  });
});

describe("buildTatoebaExamples on the fixture", () => {
  test("translated, card-length, fully known sentences with their translations", async () => {
    const result = await buildTatoebaExamples(tatoebaSourcesFrom(FIXTURE_DIR), dictionary);
    // 7 has no translation; of the other 7, 4 has unknown words and 5 is too short.
    expect(result.scanned).toBe(7);
    expect(result.passed).toBe(5);
    expect(result.candidates.map((candidate) => candidate.sourceId)).toEqual([1, 2, 3, 6, 8]);
    const [first] = result.candidates;
    expect(first).toMatchObject({
      text: "I borrowed a book from the library.",
      author: "alice",
      cefrLevel: "A2",
      wordCount: 7,
      // The lowest translation id wins: 101 over 109.
      translations: {
        ru: { id: 101, text: "Я взял книгу в библиотеке.", author: "dasha" },
        uk: { id: 201, text: "Я взяв книжку в бібліотеці.", author: "oksana" },
      },
    });
    expect(first?.wordIds).toContain(idOf("borrow"));
    expect(result.candidates.find((c) => c.sourceId === 3)?.author).toBeNull();
  });

  test("each sentence links only the words it was kept for", async () => {
    const result = await buildTatoebaExamples(tatoebaSourcesFrom(FIXTURE_DIR), dictionary, {
      minWords: 4,
      maxWords: 15,
      maxChars: 120,
      maxUnknown: 0,
      perWord: 1,
    });
    const linking = result.candidates
      .filter((candidate) => candidate.wordIds.includes(idOf("borrow")))
      .map((candidate) => candidate.sourceId);
    // Nearest the ideal 8 words: sentence 1 (7 words), in both languages.
    expect(linking).toEqual([1]);
    // Sentence 2 is still kept, for the words only it shows.
    expect(result.candidates.find((c) => c.sourceId === 2)?.wordIds).toContain(idOf("pen"));
  });
});
