// Pure conversions behind the dictionary pronunciation: CMUdict ARPAbet to IPA, phonemic
// syllables and stress, and the `WA·ter` display form. Every function returns null instead of
// guessing when its input is outside what it knows.

/** ARPAbet vowels with stress 1/2; unstressed (0) variants below where they differ. */
const VOWELS: Record<string, string> = {
  AA: "ɑː",
  AE: "æ",
  AH: "ʌ",
  AO: "ɔː",
  AW: "aʊ",
  AY: "aɪ",
  EH: "ɛ",
  ER: "ɝ",
  EY: "eɪ",
  IH: "ɪ",
  IY: "iː",
  OW: "oʊ",
  OY: "ɔɪ",
  UH: "ʊ",
  UW: "uː",
};
const UNSTRESSED_VOWELS: Record<string, string> = { AH: "ə", ER: "ɚ", IY: "i", UW: "u" };

const CONSONANTS: Record<string, string> = {
  B: "b",
  CH: "tʃ",
  D: "d",
  DH: "ð",
  F: "f",
  G: "ɡ",
  HH: "h",
  JH: "dʒ",
  K: "k",
  L: "l",
  M: "m",
  N: "n",
  NG: "ŋ",
  P: "p",
  R: "r",
  S: "s",
  SH: "ʃ",
  T: "t",
  TH: "θ",
  V: "v",
  W: "w",
  Y: "j",
  Z: "z",
  ZH: "ʒ",
};

/** English onsets a syllable may start with (maximal onset principle). */
const ONSETS = new Set([
  ...Object.keys(CONSONANTS).filter((c) => c !== "NG"),
  ...["P R", "P L", "B R", "B L", "T R", "D R", "K R", "K L", "G R", "G L", "F R", "F L"],
  ...["TH R", "SH R", "S P", "S T", "S K", "S M", "S N", "S L", "S W", "S F"],
  ...["T W", "D W", "K W", "G W", "TH W", "P Y", "B Y", "F Y", "V Y", "M Y", "K Y", "HH Y"],
  ...["S P R", "S P L", "S T R", "S K R", "S K W", "S P Y", "S K Y"],
]);

/** One CMUdict phone: a vowel carries its stress (0 none, 1 primary, 2 secondary). */
export type Phone = { symbol: string; stress: 0 | 1 | 2 | null };

/** Splits a CMUdict pronunciation (`W AO1 T ER0`); null when a phone is not ARPAbet. */
export function parseArpabet(pronunciation: string): Phone[] | null {
  const tokens = pronunciation.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const phones: Phone[] = [];
  for (const token of tokens) {
    const match = /^([A-Z]+)([012])?$/.exec(token);
    if (!match?.[1]) return null;
    const [, symbol, stress] = match;
    if (symbol in VOWELS && stress !== undefined) {
      phones.push({ symbol, stress: Number(stress) as 0 | 1 | 2 });
    } else if (symbol in CONSONANTS && stress === undefined) {
      phones.push({ symbol, stress: null });
    } else {
      return null;
    }
  }
  return phones;
}

/** Groups phones into syllables, one vowel each; consonants between vowels go by maximal onset. */
export function syllabifyPhones(phones: Phone[]): Phone[][] | null {
  const nuclei = phones.flatMap((phone, index) => (phone.stress === null ? [] : [index]));
  if (nuclei.length === 0) return null;
  const syllables: Phone[][] = [];
  let start = 0;
  for (let n = 0; n < nuclei.length; n++) {
    const nucleus = nuclei[n] as number;
    const next = nuclei[n + 1];
    if (next === undefined) {
      syllables.push(phones.slice(start));
      break;
    }
    // The consonants between this vowel and the next: the longest legal onset goes right.
    let boundary = next;
    while (
      boundary - 1 > nucleus &&
      ONSETS.has(
        phones
          .slice(boundary - 1, next)
          .map((p) => p.symbol)
          .join(" "),
      )
    ) {
      boundary--;
    }
    syllables.push(phones.slice(start, boundary));
    start = boundary;
  }
  return syllables;
}

function phoneIpa(phone: Phone): string {
  if (phone.stress === null) return CONSONANTS[phone.symbol] as string;
  if (phone.stress === 0)
    return UNSTRESSED_VOWELS[phone.symbol] ?? (VOWELS[phone.symbol] as string);
  return VOWELS[phone.symbol] as string;
}

/** The 0-based syllable with primary stress; null when none is marked. */
export function primaryStressIndex(syllables: Phone[][]): number | null {
  const index = syllables.findIndex((syllable) => syllable.some((phone) => phone.stress === 1));
  return index === -1 ? null : index;
}

/**
 * CMUdict ARPAbet to IPA without the slashes: `W AO1 T ER0` → `ˈwɔːtɚ`. Stress marks stand
 * before the stressed syllable; a single syllable carries none, as in learner dictionaries.
 */
export function arpabetToIpaBody(pronunciation: string): string | null {
  const phones = parseArpabet(pronunciation);
  const syllables = phones && syllabifyPhones(phones);
  if (!syllables) return null;
  return syllables
    .map((syllable) => {
      const stress = syllables.length > 1 ? syllable.find((p) => p.stress !== null)?.stress : 0;
      const mark = stress === 1 ? "ˈ" : stress === 2 ? "ˌ" : "";
      return mark + syllable.map(phoneIpa).join("");
    })
    .join("");
}

/** {@link arpabetToIpaBody} between slashes: `/ˈwɔːtɚ/`. */
export function arpabetToIpa(pronunciation: string): string | null {
  const body = arpabetToIpaBody(pronunciation);
  return body === null ? null : `/${body}/`;
}

/** Syllable count and primary stress of a CMUdict pronunciation. */
export function arpabetSyllables(
  pronunciation: string,
): { count: number; stressIndex: number | null } | null {
  const phones = parseArpabet(pronunciation);
  const syllables = phones && syllabifyPhones(phones);
  if (!syllables) return null;
  return {
    count: syllables.length,
    stressIndex: syllables.length === 1 ? 0 : primaryStressIndex(syllables),
  };
}

/**
 * Syllable count and primary stress read off a Wiktionary transcription that marks its syllables
 * (`/ˈwɔː.tə/`, `/ˌɪn.fəˈmeɪ.ʃən/`). Null when it has no boundaries to read: an unmarked
 * transcription is not split by guesswork.
 */
export function dottedIpaSyllables(
  ipa: string,
): { count: number; stressIndex: number | null } | null {
  const body = ipa.replace(/^\/|\/$/g, "");
  if (!/[.ˈˌ]/.test(body.slice(1)) || /\s/.test(body)) return null;
  const parts = body.split(/(?=[ˈˌ])|\./).filter((part) => part.replace(/[ˈˌ]/g, "").length > 0);
  const stressed = parts.findIndex((part) => part.startsWith("ˈ"));
  return { count: parts.length, stressIndex: stressed === -1 ? null : stressed };
}

/**
 * Normalises a Wiktionary transcription for display: drops syllable dots, tie bars (`d͡ʒ`) and
 * the non-syllabic mark (`aʊ̯`), and writes the approximant `ɹ` as `r`, the convention learner
 * dictionaries and the CMUdict conversion use. No sound is added or removed.
 */
export function normaliseWiktionaryIpa(ipa: string): string {
  return ipa.replace(/\.|͡|͜|̯/g, "").replace(/ɹ/g, "r");
}

/** The card's syllable line: `wa·ter` with stress 0 → `WA·ter`. One syllable stays as written. */
export function formatSyllables(syllables: string, stressIndex: number | null): string {
  const parts = syllables.split("·");
  if (parts.length < 2 || stressIndex === null || stressIndex >= parts.length) return syllables;
  return parts.map((part, i) => (i === stressIndex ? part.toUpperCase() : part)).join("·");
}
