import { describe, expect, test } from "bun:test";
import {
  loadPronunciationSources,
  type PronunciationSources,
  parseCmudict,
  parseWiktionaryTsv,
  pronounce,
  wordIpa,
} from "../../src/words/pronunciation";

const CMUDICT = [
  ";;; # comment line",
  "after AE1 F T ER0",
  "look L UH1 K",
  "read R EH1 D",
  "read(2) R IY1 D",
  "table T EY1 B AH0 L",
  "water W AO1 T ER0 # a trailing comment",
].join("\n");

const WIKTIONARY = [
  "word\tipa_uk\tipa_us\thyphenation",
  "after\t/ˈɑːf.tə/\t/ˈæf.tɚ/\taf·ter",
  "look\t/lʊk/\t/lʊk/\t",
  "schedule\t/ˈʃɛd͡ʒuːl/\t/ˈskɛd͡ʒ.ʊl/\t",
  "table\t/ˈteɪ.bəl/\t/ˈteɪ.bəl/\tta·ble",
  "water\t/ˈwɔː.tə/\t/ˈwɔ.tɚ/\twa·ter",
  "colour\t/ˈkʌl.ə/\t\tcol·our",
].join("\n");

const sources: PronunciationSources = {
  cmudict: parseCmudict(CMUDICT),
  wiktionary: parseWiktionaryTsv(WIKTIONARY),
};

describe("parseCmudict", () => {
  test("keeps the first pronunciation, skips alternates and comments", () => {
    expect(sources.cmudict.get("read")).toBe("R EH1 D");
    expect(sources.cmudict.get("water")).toBe("W AO1 T ER0");
    expect(sources.cmudict.has("read(2)")).toBe(false);
    expect(sources.cmudict.size).toBe(5);
  });
});

describe("parseWiktionaryTsv", () => {
  test("reads empty cells as null", () => {
    expect(sources.wiktionary.get("colour")).toEqual({
      ipaUk: "/ˈkʌl.ə/",
      ipaUs: null,
      hyphenation: "col·our",
    });
  });

  test("rejects a file with another header", () => {
    expect(() => parseWiktionaryTsv("word\tipa\nwater\t/x/")).toThrow(/header/);
  });
});

describe("pronounce", () => {
  test("US from CMUdict, UK from Wiktionary, syllables from the hyphenation", () => {
    expect(pronounce("water", sources)).toEqual({
      ipaUs: "/ˈwɔːtɚ/",
      ipaUk: "/ˈwɔːtə/",
      syllables: "wa·ter",
      stressIndex: 0,
    });
  });

  test("is case-insensitive on the lemma", () => {
    expect(pronounce(" Water ", sources).ipaUs).toBe("/ˈwɔːtɚ/");
  });

  test("falls back to Wiktionary's American IPA; no hyphenation, no syllables", () => {
    expect(pronounce("schedule", sources)).toEqual({
      ipaUs: "/ˈskɛdʒʊl/",
      ipaUk: "/ˈʃɛdʒuːl/",
      syllables: null,
      stressIndex: null,
    });
  });

  test("a one-syllable word is its own syllable", () => {
    expect(pronounce("look", sources)).toEqual({
      ipaUs: "/lʊk/",
      ipaUk: "/lʊk/",
      syllables: "look",
      stressIndex: 0,
    });
  });

  test("a hyphenation whose count disagrees with the pronunciation is not used", () => {
    const off: PronunciationSources = {
      cmudict: sources.cmudict,
      wiktionary: parseWiktionaryTsv("word\tipa_uk\tipa_us\thyphenation\nwater\t\t\twat·e·r"),
    };
    expect(pronounce("water", off)).toMatchObject({ syllables: null, stressIndex: null });
  });

  test("a phrase is put together from its tokens, without syllables", () => {
    expect(pronounce("look after", sources)).toEqual({
      ipaUs: "/lʊk ˈæftɚ/",
      ipaUk: "/lʊk ˈɑːftə/",
      syllables: null,
      stressIndex: null,
    });
  });

  test("a phrase with an unknown token gets no IPA", () => {
    expect(pronounce("look zzyzx", sources)).toEqual({
      ipaUs: null,
      ipaUk: null,
      syllables: null,
      stressIndex: null,
    });
  });

  test("UK only: no US IPA is made up", () => {
    expect(pronounce("colour", sources)).toEqual({
      ipaUs: null,
      ipaUk: "/ˈkʌlə/",
      syllables: "col·our",
      stressIndex: 0,
    });
  });

  test("a word in no source gets nothing", () => {
    expect(pronounce("zzyzx", sources)).toEqual({
      ipaUs: null,
      ipaUk: null,
      syllables: null,
      stressIndex: null,
    });
  });
});

describe("wordIpa", () => {
  const word = { ipa: "/owner/", ipaUs: "/us/", ipaUk: "/uk/" };

  test("prefers the dictionary IPA of the learner's variant", () => {
    expect(wordIpa(word, "us")).toBe("/us/");
    expect(wordIpa(word, "uk")).toBe("/uk/");
  });

  test("falls back to the owner's IPA, then to the other variant", () => {
    expect(wordIpa({ ...word, ipaUk: null }, "uk")).toBe("/owner/");
    expect(wordIpa({ ipa: null, ipaUs: "/us/", ipaUk: null }, "uk")).toBe("/us/");
    expect(wordIpa({ ipa: null, ipaUs: null, ipaUk: null }, "us")).toBeNull();
  });
});

describe("committed data", () => {
  test("parses and covers common words", async () => {
    const data = await loadPronunciationSources();
    expect(data.cmudict.size).toBeGreaterThan(100_000);
    expect(data.wiktionary.size).toBeGreaterThan(50_000);
    expect(pronounce("water", data)).toMatchObject({ ipaUs: "/ˈwɔːtɚ/", syllables: "wa·ter" });
    expect(pronounce("water", data).ipaUk).toBe("/ˈwɔːtə/");
  });
});
