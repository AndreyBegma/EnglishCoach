import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { words } from "../../src/db/schema";
import {
  type PronunciationSources,
  parseCmudict,
  parseWiktionaryTsv,
} from "../../src/words/pronunciation";
import { importPronunciation } from "../../src/words/pronunciation-import";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const sources: PronunciationSources = {
  cmudict: parseCmudict("water W AO1 T ER0\nlook L UH1 K\nafter AE1 F T ER0"),
  wiktionary: parseWiktionaryTsv(
    "word\tipa_uk\tipa_us\thyphenation\nwater\t/ˈwɔː.tə/\t\twa·ter\nafter\t/ˈɑːf.tə/\t\t",
  ),
};

describe.skipIf(!testServerUrl)("importPronunciation", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
    await database.db.insert(words).values([
      { lemma: "water", pos: "noun", cefrLevel: "A1", source: "test", ipa: "/owner/" },
      { lemma: "look after", pos: "verb", cefrLevel: "B1", source: "test" },
      // A stale value the sources no longer back is cleared.
      { lemma: "zzyzx", pos: "noun", cefrLevel: "C2", source: "test", ipaUs: "/stale/" },
    ]);
  });
  afterAll(async () => {
    await database.close();
  });

  const row = async (lemma: string) =>
    (await database.db.select().from(words).where(eq(words.lemma, lemma)))[0];

  test("fills the dictionary columns and keeps the owner's IPA", async () => {
    const result = await importPronunciation(database.db, sources);
    expect(result).toEqual({ total: 3, updated: 3, withUs: 2, withUk: 1, withSyllables: 1 });
    expect(await row("water")).toMatchObject({
      ipa: "/owner/",
      ipaUs: "/ˈwɔːtɚ/",
      ipaUk: "/ˈwɔːtə/",
      syllables: "wa·ter",
      stressIndex: 0,
    });
    expect(await row("look after")).toMatchObject({
      ipaUs: "/lʊk ˈæftɚ/",
      ipaUk: null,
      syllables: null,
      stressIndex: null,
    });
    expect((await row("zzyzx"))?.ipaUs).toBeNull();
  });

  test("is idempotent: a second run writes nothing", async () => {
    const result = await importPronunciation(database.db, sources);
    expect(result.updated).toBe(0);
    expect(result.total).toBe(3);
  });
});
