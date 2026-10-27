// Dictionary pronunciation of a word: US IPA from CMUdict, UK IPA from Wiktionary, written
// syllables with stress. Never from the LLM, never guessed: what no source covers stays null.
// Sources and licences: data/pronunciation/README.md.
import { join } from "node:path";
import type { Word } from "../db/schema";
import {
  arpabetSyllables,
  arpabetToIpa,
  arpabetToIpaBody,
  dottedIpaSyllables,
  normaliseWiktionaryIpa,
} from "./ipa";

export const PRONUNCIATION_DIR = join(import.meta.dir, "../../data/pronunciation");
const WIKTIONARY_HEADER = "word\tipa_uk\tipa_us\thyphenation";

export type WiktionaryEntry = {
  ipaUk: string | null;
  ipaUs: string | null;
  hyphenation: string | null;
};

export type PronunciationSources = {
  /** Lower-case word → its first CMUdict pronunciation (ARPAbet). */
  cmudict: Map<string, string>;
  wiktionary: Map<string, WiktionaryEntry>;
};

export type Pronunciation = {
  ipaUs: string | null;
  ipaUk: string | null;
  syllables: string | null;
  stressIndex: number | null;
};

/** Parses `cmudict.dict`; alternates (`word(2)`) and `#` comments are skipped, the first entry wins. */
export function parseCmudict(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [entry] = line.split("#");
    const match = /^(\S+)\s+(.+)$/.exec((entry ?? "").trim());
    if (!match?.[1] || !match[2] || match[1].includes("(")) continue;
    if (!map.has(match[1])) map.set(match[1], match[2].trim());
  }
  return map;
}

/** Parses `wiktionary-en.tsv`, built by `scripts/import-pronunciation-build.py`. */
export function parseWiktionaryTsv(text: string): Map<string, WiktionaryEntry> {
  const [header, ...lines] = text.split("\n").filter((line) => line.length > 0);
  if (header !== WIKTIONARY_HEADER)
    throw new Error(`unexpected wiktionary-en.tsv header: ${header}`);
  const map = new Map<string, WiktionaryEntry>();
  for (const line of lines) {
    const [word, uk, us, hyphenation] = line.split("\t");
    if (!word) continue;
    map.set(word, { ipaUk: uk || null, ipaUs: us || null, hyphenation: hyphenation || null });
  }
  return map;
}

export async function loadPronunciationSources(
  dir: string = PRONUNCIATION_DIR,
): Promise<PronunciationSources> {
  const [cmudict, wiktionary] = await Promise.all([
    Bun.file(join(dir, "cmudict.dict")).text(),
    Bun.file(join(dir, "wiktionary-en.tsv")).text(),
  ]);
  return { cmudict: parseCmudict(cmudict), wiktionary: parseWiktionaryTsv(wiktionary) };
}

/** A phrase or compound split into dictionary tokens: `look after`, `well-known`. */
function tokens(lemma: string): string[] {
  return lemma.split(/[\s-]+/).filter(Boolean);
}

/** Joins per-token transcriptions only when every token has one: half a phrase is not shown. */
function perToken(lemma: string, body: (token: string) => string | null): string | null {
  const parts = tokens(lemma);
  if (parts.length < 2) return null;
  const bodies = parts.map(body);
  return bodies.every((b) => b !== null) ? `/${bodies.join(" ")}/` : null;
}

const stripSlashes = (ipa: string): string => ipa.replace(/^\/|\/$/g, "");

/**
 * The pronunciation of a lemma from the sources. US: CMUdict, then Wiktionary's General
 * American; UK: Wiktionary's Received Pronunciation. A phrase missing from both is put together
 * from its tokens. Written syllables are Wiktionary's hyphenation, kept only when its count agrees
 * with the dictionary pronunciation; a one-syllable word is its own syllable. Spelling rules are
 * not used: on 6,528 words they matched Wiktionary's hyphenation only 52% of the time.
 */
export function pronounce(lemma: string, sources: PronunciationSources): Pronunciation {
  const word = lemma.trim().toLowerCase();
  const arpabet = sources.cmudict.get(word);
  const wiki = sources.wiktionary.get(word);

  const ipaUs =
    (arpabet && arpabetToIpa(arpabet)) ||
    (wiki?.ipaUs && normaliseWiktionaryIpa(wiki.ipaUs)) ||
    perToken(word, (token) => {
      const pron = sources.cmudict.get(token);
      return pron ? arpabetToIpaBody(pron) : null;
    });
  const ipaUk =
    (wiki?.ipaUk && normaliseWiktionaryIpa(wiki.ipaUk)) ||
    perToken(word, (token) => {
      const uk = sources.wiktionary.get(token)?.ipaUk;
      return uk ? stripSlashes(normaliseWiktionaryIpa(uk)) : null;
    });

  const shape =
    (arpabet && arpabetSyllables(arpabet)) ||
    (wiki?.ipaUk && dottedIpaSyllables(wiki.ipaUk)) ||
    (wiki?.ipaUs && dottedIpaSyllables(wiki.ipaUs)) ||
    null;
  const hyphenated = shape?.count === 1 ? [word] : (wiki?.hyphenation?.split("·") ?? null);
  const parts = shape && hyphenated?.length === shape.count ? hyphenated : null;
  // Syllables without a known stress are not shown, so they are not stored either.
  const stressed = parts && shape?.stressIndex != null;
  return {
    ipaUs: ipaUs || null,
    ipaUk: ipaUk || null,
    syllables: stressed && parts ? parts.join("·") : null,
    stressIndex: stressed && shape ? shape.stressIndex : null,
  };
}

/**
 * The IPA a card shows for the learner's variant: the dictionary transcription of that variant,
 * then the owner's transcription, then the other variant's; null when there is none.
 */
export function wordIpa(
  word: Pick<Word, "ipa" | "ipaUs" | "ipaUk">,
  variant: "us" | "uk",
): string | null {
  const [chosen, other] = variant === "uk" ? [word.ipaUk, word.ipaUs] : [word.ipaUs, word.ipaUk];
  return chosen || word.ipa || other || null;
}
