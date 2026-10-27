import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import { getWordImage } from "../../src/db/repositories/images";
import { words } from "../../src/db/schema";
import { createWordImages, type ImageKeys } from "../../src/images";
import { createLogger } from "../../src/log";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { FakeStock, PEXELS_KEY, UNSPLASH_KEY } from "./fake-stock";

const BOTH: ImageKeys = { PEXELS_API_KEY: PEXELS_KEY, UNSPLASH_ACCESS_KEY: UNSPLASH_KEY };

describe("word pictures: fetched once per word, Pexels then Unsplash", () => {
  test("with no key there is no picture service at all", () => {
    const log = createLogger({ level: "error" });
    expect(createWordImages({}, { db: {} as never, log })).toBeUndefined();
  });
});

describe.skipIf(!testServerUrl)("word pictures stored in the database", () => {
  let database: Database;
  let nextLemma = 0;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  async function newWord() {
    const [word] = await database.db
      .insert(words)
      .values({ lemma: `word${nextLemma++}`, pos: "noun", cefrLevel: "A2", source: "test" })
      .returning();
    if (!word) throw new Error("no word");
    return word.id;
  }

  function setup(keys: ImageKeys = BOTH) {
    const stock = new FakeStock();
    const logs: string[] = [];
    const log = createLogger({ level: "debug", write: (line) => logs.push(line) });
    const images = createWordImages(keys, { db: database.db, log }, stock.fetch);
    if (!images) throw new Error("no images");
    return { stock, images, logs };
  }

  test("primary: Pexels; the photo and its credit are stored", async () => {
    const { stock, images } = setup();
    const wordId = await newWord();
    const image = await images.forWord(wordId, "red apple");
    expect(image).toMatchObject({
      wordId,
      query: "red apple",
      resultIndex: 0,
      source: "pexels",
      url: "https://images.pexels.com/red-apple-1.jpg",
      authorName: "Pexels Author 1",
      pageUrl: "https://www.pexels.com/photo/red-apple-1/",
      width: 1200,
      height: 800,
    });
    expect(stock.count("api.unsplash.com")).toBe(0);
    expect(await getWordImage(database.db, wordId)).toMatchObject({ source: "pexels" });
  });

  test("fetched once: a second learner's card makes no HTTP call", async () => {
    const { stock, images } = setup();
    const wordId = await newWord();
    await images.forWord(wordId, "red apple");
    const calls = stock.calls.length;
    const again = await setup().images.forWord(wordId, "something else");
    expect(again?.url).toBe("https://images.pexels.com/red-apple-1.jpg");
    expect(stock.calls.length).toBe(calls);
  });

  test("fallback: Pexels fails, Unsplash answers and is told the photo is used", async () => {
    const { stock, images, logs } = setup();
    stock.pexels = "error";
    const wordId = await newWord();
    const image = await images.forWord(wordId, "river");
    expect(image).toMatchObject({ source: "unsplash", authorName: "Unsplash Author 1" });
    expect(stock.count("api.unsplash.com", "/download")).toBe(1);
    expect(logs.some((line) => line.includes("image search failed"))).toBe(true);
    expect(logs.join("\n")).not.toContain(PEXELS_KEY);
  });

  test("only an Unsplash key: Unsplash is the only source", async () => {
    const { stock, images } = setup({ UNSPLASH_ACCESS_KEY: UNSPLASH_KEY });
    const image = await images.forWord(await newWord(), "river");
    expect(image?.source).toBe("unsplash");
    expect(stock.count("api.pexels.com")).toBe(0);
  });

  test("every source fails: no picture, nothing stored, the next card tries again", async () => {
    const { stock, images, logs } = setup();
    stock.pexels = "down";
    stock.unsplash = "error";
    const wordId = await newWord();
    expect(await images.forWord(wordId, "river")).toBeUndefined();
    expect(await getWordImage(database.db, wordId)).toBeUndefined();
    expect(logs.join("\n")).not.toContain(PEXELS_KEY);
    expect(logs.join("\n")).not.toContain(UNSPLASH_KEY);

    stock.pexels = "ok";
    expect((await images.forWord(wordId, "river"))?.source).toBe("pexels");
  });

  test("nothing found anywhere: remembered, not searched again", async () => {
    const { stock, images } = setup();
    stock.pexels = "empty";
    stock.unsplash = "empty";
    const wordId = await newWord();
    expect(await images.forWord(wordId, "zzz")).toBeUndefined();
    const calls = stock.calls.length;
    expect(await images.forWord(wordId, "zzz")).toBeUndefined();
    expect(stock.calls.length).toBe(calls);
    expect(await getWordImage(database.db, wordId)).toMatchObject({ url: null });
  });

  test("another picture: the next result, saved for the word; at the end the last one stays", async () => {
    const { images } = setup();
    const wordId = await newWord();
    await images.forWord(wordId, "cat");
    expect((await images.next(wordId, "cat"))?.url).toBe("https://images.pexels.com/cat-2.jpg");
    expect(await getWordImage(database.db, wordId)).toMatchObject({ resultIndex: 1 });
    expect((await images.next(wordId, "cat"))?.resultIndex).toBe(2);
    // FakeStock has 3 results per query on each source: index 3 is past both.
    expect(await images.next(wordId, "cat")).toBeUndefined();
    expect((await images.forWord(wordId, "cat"))?.url).toBe("https://images.pexels.com/cat-3.jpg");
  });
});
