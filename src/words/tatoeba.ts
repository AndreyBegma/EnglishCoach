import { type CefrLevel, cefrLevelEnum, type ExampleTranslations } from "../db/schema";

// Tatoeba's per-language exports (https://tatoeba.org/en/downloads), CC BY 2.0 FR. Sentences are
// `id \t lang \t text \t username \t added \t modified` (the plain export has the first three
// columns only), links `english id \t translation id`. Usernames are `\N` for orphan sentences.

export const TATOEBA_LANGS = { ru: "rus", uk: "ukr" } as const;
export type TatoebaLang = keyof typeof TATOEBA_LANGS;

/** The export files the import reads, by role, named as Tatoeba names them after decompression. */
export const TATOEBA_FILES = {
  english: "eng_sentences_detailed.tsv",
  sentences: { ru: "rus_sentences_detailed.tsv", uk: "ukr_sentences_detailed.tsv" },
  links: { ru: "eng-rus_links.tsv", uk: "eng-ukr_links.tsv" },
} as const;

/** Each source is the file's lines. */
export type TatoebaSources = {
  english: AsyncIterable<string>;
  sentences: Record<TatoebaLang, AsyncIterable<string>>;
  links: Record<TatoebaLang, AsyncIterable<string>>;
};

export type TatoebaSentence = { id: number; text: string; author: string | null };

export function parseSentenceLine(line: string): TatoebaSentence | undefined {
  const [id, , text, author] = line.split("\t");
  const number = Number(id);
  if (!Number.isInteger(number) || number <= 0 || !text?.trim()) return undefined;
  return { id: number, text: text.trim(), author: author && author !== "\\N" ? author : null };
}

export function parseLinkLine(line: string): [number, number] | undefined {
  const [from, to] = line.split("\t").map(Number);
  if (!Number.isInteger(from) || !Number.isInteger(to) || !from || !to) return undefined;
  return [from, to];
}

/** Splits a byte stream into lines, without holding the whole file. */
export async function* linesOf(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of stream) {
    rest += decoder.decode(chunk, { stream: true });
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) yield line.replace(/\r$/, "");
  }
  rest += decoder.decode();
  if (rest) yield rest;
}

// ---------------------------------------------------------------- matching sentences to lemmas

/** A dictionary word, as the matcher needs it. */
export type DictionaryWord = { id: number; lemma: string; cefrLevel: CefrLevel };

const LEVELS = cefrLevelEnum.enumValues;
const levelIndex = (level: CefrLevel) => LEVELS.indexOf(level);

/** Contractions written as one token in a sentence, split back into words. */
const CONTRACTIONS: Record<string, string[]> = {
  "can't": ["can", "not"],
  cannot: ["can", "not"],
  "won't": ["will", "not"],
  "shan't": ["shall", "not"],
  "i'm": ["i", "am"],
  "let's": ["let", "us"],
};
const CLITICS: Record<string, string> = {
  "n't": "not",
  "'re": "are",
  "'ve": "have",
  "'ll": "will",
  "'d": "would",
  "'m": "am",
};

/** Forms no suffix rule reaches: the irregular verbs and pronouns of everyday sentences. */
const IRREGULAR: Record<string, string> = {
  am: "be",
  is: "be",
  are: "be",
  was: "be",
  were: "be",
  been: "be",
  being: "be",
  has: "have",
  had: "have",
  does: "do",
  did: "do",
  done: "do",
  went: "go",
  gone: "go",
  saw: "see",
  seen: "see",
  came: "come",
  took: "take",
  taken: "take",
  made: "make",
  got: "get",
  gotten: "get",
  gave: "give",
  given: "give",
  knew: "know",
  known: "know",
  thought: "think",
  told: "tell",
  said: "say",
  found: "find",
  left: "leave",
  felt: "feel",
  kept: "keep",
  brought: "bring",
  bought: "buy",
  began: "begin",
  begun: "begin",
  ran: "run",
  wrote: "write",
  written: "write",
  ate: "eat",
  eaten: "eat",
  drank: "drink",
  drunk: "drink",
  slept: "sleep",
  spoke: "speak",
  spoken: "speak",
  stood: "stand",
  sat: "sit",
  met: "meet",
  paid: "pay",
  sent: "send",
  spent: "spend",
  built: "build",
  lost: "lose",
  held: "hold",
  heard: "hear",
  understood: "understand",
  taught: "teach",
  caught: "catch",
  fought: "fight",
  forgot: "forget",
  forgotten: "forget",
  chose: "choose",
  chosen: "choose",
  broke: "break",
  broken: "break",
  drove: "drive",
  driven: "drive",
  flew: "fly",
  flown: "fly",
  grew: "grow",
  grown: "grow",
  threw: "throw",
  thrown: "throw",
  wore: "wear",
  worn: "wear",
  won: "win",
  fell: "fall",
  fallen: "fall",
  rode: "ride",
  ridden: "ride",
  sang: "sing",
  sung: "sing",
  swam: "swim",
  woke: "wake",
  woken: "wake",
  hid: "hide",
  hidden: "hide",
  meant: "mean",
  led: "lead",
  lent: "lend",
  sold: "sell",
  shot: "shoot",
  stole: "steal",
  stolen: "steal",
  struck: "strike",
  became: "become",
  better: "good",
  best: "good",
  worse: "bad",
  worst: "bad",
  children: "child",
  men: "man",
  women: "woman",
  people: "person",
  feet: "foot",
  teeth: "tooth",
  mice: "mouse",
  me: "i",
  my: "i",
  mine: "i",
  him: "he",
  his: "he",
  her: "she",
  hers: "she",
  us: "we",
  our: "we",
  ours: "we",
  them: "they",
  their: "they",
  theirs: "they",
  your: "you",
  yours: "you",
  its: "it",
  an: "a",
};

const DOUBLED = /([bcdfgklmnprstvz])\1$/;

/** The base forms a sentence token may be an inflection of, the token itself first. */
export function baseForms(token: string): string[] {
  const forms = [token];
  const irregular = IRREGULAR[token];
  if (irregular) forms.push(irregular);
  const add = (stem: string) => {
    if (stem.length < 2) return;
    forms.push(stem);
    if (DOUBLED.test(stem)) forms.push(stem.slice(0, -1));
  };
  if (token.endsWith("ies") || token.endsWith("ied")) add(`${token.slice(0, -3)}y`);
  if (token.endsWith("es")) add(token.slice(0, -2));
  if (token.endsWith("s") && !token.endsWith("ss")) add(token.slice(0, -1));
  if (token.endsWith("ed")) {
    add(token.slice(0, -2));
    add(token.slice(0, -1));
  }
  if (token.endsWith("ing")) {
    add(token.slice(0, -3));
    add(`${token.slice(0, -3)}e`);
  }
  if (token.endsWith("ier") || token.endsWith("iest")) add(`${token.replace(/iest$|ier$/, "")}y`);
  if (token.endsWith("er")) {
    add(token.slice(0, -2));
    add(token.slice(0, -1));
  }
  if (token.endsWith("est")) {
    add(token.slice(0, -3));
    add(token.slice(0, -2));
  }
  if (token.endsWith("ly")) add(token.slice(0, -2));
  return [...new Set(forms)];
}

type Token = { text: string; name: boolean };

/**
 * The sentence's words, lowercased, contractions split and possessives dropped. `name` marks a
 * capitalised word other than `I`: when the dictionary does not know it, it is a name (`Tom`,
 * `Paris`), not an unknown word.
 */
export function tokenize(sentence: string): Token[] {
  const tokens: Token[] = [];
  const raw = sentence.replaceAll("’", "'").match(/[\p{L}]+(?:['-][\p{L}]+)*/gu) ?? [];
  for (const word of raw) {
    const name = /^\p{Lu}/u.test(word) && word !== "I";
    let lower = word.toLowerCase();
    const whole = CONTRACTIONS[lower];
    if (whole) {
      for (const text of whole) tokens.push({ text, name: false });
      continue;
    }
    const clitic = Object.keys(CLITICS).find((end) => lower.endsWith(end) && lower !== end);
    if (lower.endsWith("'s")) lower = lower.slice(0, -2);
    else if (clitic) {
      tokens.push({ text: lower.slice(0, -clitic.length), name });
      tokens.push({ text: CLITICS[clitic] ?? clitic, name: false });
      continue;
    }
    for (const part of lower.split("-")) if (part) tokens.push({ text: part, name });
  }
  return tokens;
}

/** The dictionary indexed for matching: one-word lemmas, and phrases by their first word. */
export class LemmaIndex {
  private readonly single = new Map<string, DictionaryWord[]>();
  private readonly phrases = new Map<string, { parts: string[]; words: DictionaryWord[] }[]>();

  constructor(words: readonly DictionaryWord[]) {
    for (const word of words) {
      const parts = word.lemma.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const [first] = parts;
      if (!first) continue;
      if (parts.length === 1) {
        this.single.set(first, [...(this.single.get(first) ?? []), word]);
        continue;
      }
      const list = this.phrases.get(first) ?? [];
      const same = list.find((phrase) => phrase.parts.join(" ") === parts.join(" "));
      if (same) same.words.push(word);
      else list.push({ parts, words: [word] });
      this.phrases.set(first, list);
    }
  }

  /** The dictionary words a token can be, by its base forms. */
  lookup(token: string): DictionaryWord[] {
    for (const form of baseForms(token)) {
      const found = this.single.get(form);
      if (found) return found;
    }
    return [];
  }

  /** The phrases (`look after`) that start at `index`: first word inflected, the rest exact. */
  private phrasesAt(tokens: Token[], index: number): DictionaryWord[] {
    const head = tokens[index];
    if (!head) return [];
    const words: DictionaryWord[] = [];
    for (const form of baseForms(head.text)) {
      for (const phrase of this.phrases.get(form) ?? []) {
        const rest = tokens.slice(index + 1, index + phrase.parts.length).map((t) => t.text);
        if (rest.join(" ") === phrase.parts.slice(1).join(" ")) words.push(...phrase.words);
      }
    }
    return words;
  }

  /**
   * Matches a sentence: the words it shows, its level estimate (the highest of its words, each
   * word at its lowest listed level), and how many of its words the dictionary does not know.
   * Names count as neither. A word that opens a phrase shows the phrase, not itself: "look up to
   * him" is no example of `look`.
   */
  match(sentence: string): { words: DictionaryWord[]; level: CefrLevel; unknown: number } {
    const tokens = tokenize(sentence);
    const found = new Map<number, DictionaryWord>();
    let level = 0;
    let unknown = 0;
    tokens.forEach((token, index) => {
      const hits = this.lookup(token.text);
      if (!hits.length) {
        if (!token.name) unknown++;
        return;
      }
      level = Math.max(level, Math.min(...hits.map((word) => levelIndex(word.cefrLevel))));
      const phrases = this.phrasesAt(tokens, index);
      if (phrases.length) {
        level = Math.max(level, Math.min(...phrases.map((word) => levelIndex(word.cefrLevel))));
      }
      for (const word of phrases.length ? phrases : hits) found.set(word.id, word);
    });
    return { words: [...found.values()], level: LEVELS[level] ?? "A1", unknown };
  }
}

// ---------------------------------------------------------------- choosing the examples

export type ExampleFilter = {
  minWords: number;
  maxWords: number;
  maxChars: number;
  /** Dictionary-unknown words allowed in a sentence (names do not count). */
  maxUnknown: number;
  /** Sentences kept per word and translation language. */
  perWord: number;
};

export const DEFAULT_FILTER: ExampleFilter = {
  minWords: 4,
  maxWords: 15,
  maxChars: 120,
  maxUnknown: 0,
  perWord: 10,
};

/** The length a card example reads best at; ranking prefers sentences near it. */
const IDEAL_WORDS = 8;

export type ExampleCandidate = {
  sourceId: number;
  text: string;
  author: string | null;
  cefrLevel: CefrLevel;
  wordCount: number;
  translations: ExampleTranslations;
  wordIds: number[];
};

/**
 * Orders a word's candidates: at or below the word's level first ("where possible": a sentence
 * above it is still better than none), then nearest the ideal length, then by id so the same
 * export always gives the same choice.
 */
export function rankFor(level: CefrLevel) {
  const at = levelIndex(level);
  type Ranked = Pick<ExampleCandidate, "sourceId" | "cefrLevel" | "wordCount">;
  return (a: Ranked, b: Ranked) =>
    Number(levelIndex(a.cefrLevel) > at) - Number(levelIndex(b.cefrLevel) > at) ||
    levelIndex(a.cefrLevel) - levelIndex(b.cefrLevel) ||
    Math.abs(a.wordCount - IDEAL_WORDS) - Math.abs(b.wordCount - IDEAL_WORDS) ||
    a.sourceId - b.sourceId;
}

/** Keeps the lowest translation id per English sentence: the oldest, usually most reviewed. */
async function readLinks(lines: AsyncIterable<string>, into: Map<number, number>) {
  for await (const line of lines) {
    const link = parseLinkLine(line);
    if (!link) continue;
    const [english, translation] = link;
    const known = into.get(english);
    if (known === undefined || translation < known) into.set(english, translation);
  }
}

async function readSentences(lines: AsyncIterable<string>, wanted: Set<number>) {
  const found = new Map<number, TatoebaSentence>();
  for await (const line of lines) {
    const sentence = parseSentenceLine(line);
    if (sentence && wanted.has(sentence.id)) found.set(sentence.id, sentence);
  }
  return found;
}

export type BuildResult = {
  /** English sentences with a ru or uk translation. */
  scanned: number;
  /** Of those, sentences that passed the length and vocabulary filters. */
  passed: number;
  candidates: ExampleCandidate[];
};

/**
 * Reads the exports and picks the example sentences: English sentences with a Russian or
 * Ukrainian translation, of a card's length, every word known to the dictionary, kept when they
 * are among the best `perWord` for one of the words they show in one of the languages. Each
 * candidate keeps links only to the words it was kept for.
 */
export async function buildTatoebaExamples(
  sources: TatoebaSources,
  dictionary: readonly DictionaryWord[],
  filter: ExampleFilter = DEFAULT_FILTER,
): Promise<BuildResult> {
  const langs = Object.keys(TATOEBA_LANGS) as TatoebaLang[];
  const links = new Map<TatoebaLang, Map<number, number>>();
  const translated = new Map<TatoebaLang, Map<number, TatoebaSentence>>();
  for (const lang of langs) {
    const map = new Map<number, number>();
    await readLinks(sources.links[lang], map);
    links.set(lang, map);
    translated.set(lang, await readSentences(sources.sentences[lang], new Set(map.values())));
  }

  const index = new LemmaIndex(dictionary);
  const levelOf = new Map(dictionary.map((word) => [word.id, word.cefrLevel]));
  // Per language, per word: the best candidates so far, kept sorted and at most `perWord` long.
  const best = new Map<TatoebaLang, Map<number, ExampleCandidate[]>>(
    langs.map((lang) => [lang, new Map()]),
  );
  let scanned = 0;
  let passed = 0;

  for await (const line of sources.english) {
    const sentence = parseSentenceLine(line);
    if (!sentence) continue;
    const translations: ExampleTranslations = {};
    for (const lang of langs) {
      const id = links.get(lang)?.get(sentence.id);
      const target = id === undefined ? undefined : translated.get(lang)?.get(id);
      if (target) translations[lang] = target;
    }
    if (!Object.keys(translations).length) continue;
    scanned++;

    const wordCount = tokenize(sentence.text).length;
    if (wordCount < filter.minWords || wordCount > filter.maxWords) continue;
    if (sentence.text.length > filter.maxChars) continue;
    const match = index.match(sentence.text);
    if (match.unknown > filter.maxUnknown || !match.words.length) continue;
    passed++;

    const candidate: ExampleCandidate = {
      sourceId: sentence.id,
      text: sentence.text,
      author: sentence.author,
      cefrLevel: match.level,
      wordCount,
      translations,
      wordIds: [],
    };
    for (const lang of langs) {
      if (!translations[lang]) continue;
      const perWord = best.get(lang);
      if (!perWord) continue;
      for (const word of match.words) {
        const list = perWord.get(word.id) ?? [];
        list.push(candidate);
        list.sort(rankFor(levelOf.get(word.id) ?? "C2"));
        if (list.length > filter.perWord) list.pop();
        perWord.set(word.id, list);
      }
    }
  }

  const kept = new Map<number, ExampleCandidate>();
  for (const perWord of best.values()) {
    for (const [wordId, list] of perWord) {
      for (const candidate of list) {
        if (!candidate.wordIds.includes(wordId)) candidate.wordIds.push(wordId);
        kept.set(candidate.sourceId, candidate);
      }
    }
  }
  const candidates = [...kept.values()].sort((a, b) => a.sourceId - b.sourceId);
  for (const candidate of candidates) candidate.wordIds.sort((a, b) => a - b);
  return { scanned, passed, candidates };
}
