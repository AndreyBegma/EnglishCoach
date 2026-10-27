import { describe, expect, test } from "bun:test";
import {
  arpabetSyllables,
  arpabetToIpa,
  dottedIpaSyllables,
  formatSyllables,
  normaliseWiktionaryIpa,
  parseArpabet,
} from "../../src/words/ipa";

describe("arpabetToIpa", () => {
  test.each([
    ["W AO1 T ER0", "/ˈwɔːtɚ/"],
    ["AH0 B AW1 T", "/əˈbaʊt/"],
    ["IH2 N F ER0 M EY1 SH AH0 N", "/ˌɪnfɚˈmeɪʃən/"],
    ["HH AE1 P IY0", "/ˈhæpi/"],
    ["EH1 K S T R AH0", "/ˈɛkstrə/"],
    ["F OW1 T AH0 G R AE2 F", "/ˈfoʊtəˌɡræf/"],
    ["JH AH1 JH", "/dʒʌdʒ/"],
    ["TH IH1 NG K", "/θɪŋk/"],
    ["DH AH0", "/ðə/"],
  ])("%s → %s", (arpabet, ipa) => {
    expect(arpabetToIpa(arpabet)).toBe(ipa);
  });

  test("a single syllable carries no stress mark", () => {
    expect(arpabetToIpa("S T R IY1 T")).toBe("/striːt/");
  });

  test("unknown phones, a vowel without stress or a stressed consonant give null", () => {
    expect(arpabetToIpa("W XX1")).toBeNull();
    expect(arpabetToIpa("W AO T")).toBeNull();
    expect(arpabetToIpa("T1 AO1")).toBeNull();
    expect(arpabetToIpa("")).toBeNull();
    expect(parseArpabet("w ao1")).toBeNull();
  });

  test("a pronunciation without a vowel gives null", () => {
    expect(arpabetToIpa("HH M")).toBeNull();
  });
});

describe("arpabetSyllables", () => {
  test("counts syllables and finds the primary stress", () => {
    expect(arpabetSyllables("W AO1 T ER0")).toEqual({ count: 2, stressIndex: 0 });
    expect(arpabetSyllables("IH2 N F ER0 M EY1 SH AH0 N")).toEqual({ count: 4, stressIndex: 2 });
    expect(arpabetSyllables("K AE1 T")).toEqual({ count: 1, stressIndex: 0 });
  });

  test("a word with no primary stress has no stress index", () => {
    expect(arpabetSyllables("IH0 N T UW0")).toEqual({ count: 2, stressIndex: null });
  });
});

describe("dottedIpaSyllables", () => {
  test("reads boundaries marked by dots and stress marks", () => {
    expect(dottedIpaSyllables("/ˈwɔː.tə/")).toEqual({ count: 2, stressIndex: 0 });
    expect(dottedIpaSyllables("/ˌɪn.fəˈmeɪ.ʃən/")).toEqual({ count: 4, stressIndex: 2 });
    expect(dottedIpaSyllables("/əˈbaʊ̯t/")).toEqual({ count: 2, stressIndex: 1 });
  });

  test("an unmarked transcription is not split", () => {
    expect(dottedIpaSyllables("/kæt/")).toBeNull();
    expect(dottedIpaSyllables("/ˈʃɛd͡ʒuːl/")).toBeNull();
    expect(dottedIpaSyllables("/lʊk ˈɑːf.tə/")).toBeNull();
  });
});

describe("normaliseWiktionaryIpa", () => {
  test("drops dots, tie bars and non-syllabic marks, writes ɹ as r", () => {
    expect(normaliseWiktionaryIpa("/ˈwɔː.tə/")).toBe("/ˈwɔːtə/");
    expect(normaliseWiktionaryIpa("/ˈʃɛd͡ʒuːl/")).toBe("/ˈʃɛdʒuːl/");
    expect(normaliseWiktionaryIpa("/əˈbaʊ̯t/")).toBe("/əˈbaʊt/");
    expect(normaliseWiktionaryIpa("/ˈɹɛk.ɔːd/")).toBe("/ˈrɛkɔːd/");
  });
});

describe("formatSyllables", () => {
  test("upper-cases the stressed syllable", () => {
    expect(formatSyllables("wa·ter", 0)).toBe("WA·ter");
    expect(formatSyllables("in·for·ma·tion", 2)).toBe("in·for·MA·tion");
  });

  test("leaves one syllable, an unknown stress or an out-of-range index as written", () => {
    expect(formatSyllables("cat", 0)).toBe("cat");
    expect(formatSyllables("wa·ter", null)).toBe("wa·ter");
    expect(formatSyllables("wa·ter", 5)).toBe("wa·ter");
  });
});
