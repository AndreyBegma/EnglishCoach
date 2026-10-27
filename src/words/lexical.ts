import { join } from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import {
  type CefrLevel,
  cefrLevelEnum,
  type LexicalDetails,
  type LexicalUnitType,
  words,
} from "../db/schema";
import type { PhrasalVerbSeed } from "./owner-extras";

/**
 * Lexical units beyond single words (`data/lexical/`, sources in its README): phrasal verbs,
 * collocations, idioms and word families. Each is a `words` row with its `unit_type`, so cards,
 * the enrichment cache, pictures and voices treat it like a word. The generated lists pass
 * `checkLexicalData` — the second check the seed relies on — before anything is loaded.
 */

export type LexicalType = Exclude<LexicalUnitType, "word">;

/** `words.pos` of each unit type: unique per type, and what enrichment is told the unit is. */
export const UNIT_POS: Record<LexicalType, string> = {
  phrasal_verb: "phrasal verb",
  collocation: "collocation",
  idiom: "idiom",
  word_family: "word family",
};

/** `words.source` of the owner's phrasal verbs (`seed/phrasal-verbs.json`) and of the generated lists. */
export const OWNER_PHRASAL_SOURCE = "owner_phrasal_verbs";
export const GENERATED_LEXICAL_SOURCE = "lexical-gen-1";

/** Idioms are taught from B2 up; the data and the picker both hold to it. */
export const IDIOM_MIN_LEVEL: CefrLevel = "B2";

/** Most units of one type a single level may hold: keeps a generated list from flooding a level. */
export const LEVEL_CAPS: Record<LexicalType, number> = {
  phrasal_verb: 170,
  collocation: 60,
  idiom: 50,
  word_family: 40,
};

const WORD_POS = ["noun", "verb", "adjective", "adverb"] as const;
const level = z.enum(cefrLevelEnum.enumValues);
const phrase = z.string().trim().min(1);

export const phrasalVerbEntry = z.strictObject({ phrase, verb: phrase, particle: phrase, level });
export const collocationEntry = z.strictObject({ phrase, partner: phrase, level });
export const idiomEntry = z.strictObject({ phrase, level });
export const wordFamilyEntry = z.strictObject({
  lemma: phrase,
  level,
  forms: z.array(z.tuple([z.enum(WORD_POS), phrase])).min(2),
});

export type LexicalData = {
  phrasalVerbs: z.infer<typeof phrasalVerbEntry>[];
  collocations: z.infer<typeof collocationEntry>[];
  idioms: z.infer<typeof idiomEntry>[];
  wordFamilies: z.infer<typeof wordFamilyEntry>[];
};

const FILES = {
  phrasalVerbs: ["phrasal-verbs.json", phrasalVerbEntry],
  collocations: ["collocations.json", collocationEntry],
  idioms: ["idioms.json", idiomEntry],
  wordFamilies: ["word-families.json", wordFamilyEntry],
} as const;

/** Reads and shape-checks `data/lexical/*.json`; a malformed file throws naming it. */
export async function readLexicalData(dir: string): Promise<LexicalData> {
  const read = async <T>(file: string, entry: z.ZodType<T>): Promise<T[]> => {
    const parsed = z.array(entry).safeParse(await Bun.file(join(dir, file)).json());
    if (!parsed.success) throw new Error(`invalid ${file}: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  };
  return {
    phrasalVerbs: await read(...FILES.phrasalVerbs),
    collocations: await read(...FILES.collocations),
    idioms: await read(...FILES.idioms),
    wordFamilies: await read(...FILES.wordFamilies),
  };
}

/** The phrase a learner types for a phrasal verb: the first variant, without the optional part. */
export function phrasalCore(phrase: string): string {
  return (phrase.split(" / ")[0] ?? phrase).replace(/\s*\([^)]*\)/g, "").trim();
}

const levelIndex = (value: CefrLevel) => cefrLevelEnum.enumValues.indexOf(value);
const hasWord = (text: string, word: string) => ` ${text.toLowerCase()} `.includes(` ${word} `);

/**
 * The second check over the lists: what a careless generation gets wrong. Every head word is in
 * the CEFR dictionary, a phrasal verb is its verb plus its particle, a collocation contains its
 * partner word, a family contains its lemma and no form twice, idioms sit at B2 or above, nothing
 * is listed twice, no level exceeds its cap, and every one of the owner's phrasal verbs is there.
 * Returns the problems; empty means the data may be loaded.
 */
export function checkLexicalData(
  data: LexicalData,
  dictionary: ReadonlySet<string>,
  owner: readonly PhrasalVerbSeed[],
): string[] {
  const problems: string[] = [];
  const known = (word: string) => dictionary.has(word.toLowerCase());
  const counts = new Map<string, number>();
  const count = (type: LexicalType, at: CefrLevel) => {
    const key = `${type} ${at}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const unique = (type: string, keys: string[]) => {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) problems.push(`${type}: "${key}" is listed twice`);
      seen.add(key);
    }
  };

  // The owner's verbs are curated by a person; only the generated ones need their verb vouched for.
  const ownerPhrases = new Set(owner.map((verb) => verb.phrase));
  for (const entry of data.phrasalVerbs) {
    count("phrasal_verb", entry.level);
    if (phrasalCore(entry.phrase) !== `${entry.verb} ${entry.particle}`) {
      problems.push(`phrasal verb "${entry.phrase}" is not "${entry.verb} ${entry.particle}"`);
    }
    if (!ownerPhrases.has(entry.phrase) && !known(entry.verb)) {
      problems.push(`phrasal verb "${entry.phrase}": verb not in dictionary`);
    }
  }
  unique(
    "phrasal verb",
    data.phrasalVerbs.map((entry) => entry.phrase),
  );
  const listed = new Set(data.phrasalVerbs.map((entry) => entry.phrase));
  for (const verb of owner) {
    if (!listed.has(verb.phrase)) problems.push(`owner phrasal verb "${verb.phrase}" has no level`);
  }

  for (const entry of data.collocations) {
    count("collocation", entry.level);
    if (!entry.phrase.includes(" ")) problems.push(`collocation "${entry.phrase}" is one word`);
    if (!hasWord(entry.phrase, entry.partner)) {
      problems.push(`collocation "${entry.phrase}" does not contain "${entry.partner}"`);
    }
    if (!known(entry.partner)) {
      problems.push(`collocation "${entry.phrase}": "${entry.partner}" not in dictionary`);
    }
  }
  unique(
    "collocation",
    data.collocations.map((entry) => entry.phrase),
  );

  for (const entry of data.idioms) {
    count("idiom", entry.level);
    if (levelIndex(entry.level) < levelIndex(IDIOM_MIN_LEVEL)) {
      problems.push(`idiom "${entry.phrase}" is below ${IDIOM_MIN_LEVEL}`);
    }
    if (!entry.phrase.includes(" ")) problems.push(`idiom "${entry.phrase}" is one word`);
  }
  unique(
    "idiom",
    data.idioms.map((entry) => entry.phrase),
  );

  for (const entry of data.wordFamilies) {
    count("word_family", entry.level);
    const forms = entry.forms.map(([, form]) => form);
    if (!forms.includes(entry.lemma)) {
      problems.push(`word family "${entry.lemma}" does not list its lemma`);
    }
    if (new Set(forms).size !== forms.length) {
      problems.push(`word family "${entry.lemma}" lists a form twice`);
    }
    if (!known(entry.lemma)) problems.push(`word family "${entry.lemma}": not in dictionary`);
  }
  unique(
    "word family",
    data.wordFamilies.map((entry) => entry.lemma),
  );

  for (const [key, n] of counts) {
    const [type, at] = key.split(" ") as [LexicalType, CefrLevel];
    if (n > LEVEL_CAPS[type]) problems.push(`${type} ${at}: ${n} units, cap ${LEVEL_CAPS[type]}`);
  }
  return problems;
}

/** A `words` row for one unit. */
export type UnitRow = {
  lemma: string;
  pos: string;
  unitType: LexicalType;
  cefrLevel: CefrLevel;
  details: LexicalDetails | null;
  source: string;
  /** Position in its list, 1-based: the learning order within a type and level. */
  curriculumIndex: number;
  translationRu: string | null;
  example: string | null;
};

/**
 * The rows to load. An owner phrasal verb keeps the owner's translation and example and is marked
 * as the owner's; the rest come without either (enrichment writes them per learner language).
 */
export function lexicalUnitRows(data: LexicalData, owner: readonly PhrasalVerbSeed[]): UnitRow[] {
  const byPhrase = new Map(owner.map((verb) => [verb.phrase, verb]));
  const row = (
    unitType: LexicalType,
    lemma: string,
    cefrLevel: CefrLevel,
    details: LexicalDetails | null,
    index: number,
  ): UnitRow => ({
    lemma,
    pos: UNIT_POS[unitType],
    unitType,
    cefrLevel,
    details,
    source: GENERATED_LEXICAL_SOURCE,
    curriculumIndex: index + 1,
    translationRu: null,
    example: null,
  });
  return [
    ...data.phrasalVerbs.map((entry, index) => {
      const ownerVerb = byPhrase.get(entry.phrase);
      const base = row(
        "phrasal_verb",
        entry.phrase,
        entry.level,
        { kind: "phrasal_verb", verb: entry.verb, particle: entry.particle },
        index,
      );
      return ownerVerb
        ? {
            ...base,
            source: OWNER_PHRASAL_SOURCE,
            translationRu: ownerVerb.translationRu,
            example: ownerVerb.example,
          }
        : base;
    }),
    ...data.collocations.map((entry, index) =>
      row(
        "collocation",
        entry.phrase,
        entry.level,
        { kind: "collocation", partner: entry.partner },
        index,
      ),
    ),
    ...data.idioms.map((entry, index) => row("idiom", entry.phrase, entry.level, null, index)),
    ...data.wordFamilies.map((entry, index) =>
      row(
        "word_family",
        entry.lemma,
        entry.level,
        { kind: "word_family", forms: entry.forms.map(([pos, form]) => ({ pos, form })) },
        index,
      ),
    ),
  ];
}

/**
 * Checks the lists and upserts every unit on `(lemma, pos)`; throws listing the problems instead
 * of loading anything when the check fails. Idempotent. Returns the number of units per type.
 */
export async function seedLexicalUnits(
  db: Db,
  data: LexicalData,
  dictionary: ReadonlySet<string>,
  owner: readonly PhrasalVerbSeed[],
): Promise<Record<LexicalType, number>> {
  const problems = checkLexicalData(data, dictionary, owner);
  if (problems.length > 0) {
    throw new Error(`data/lexical failed its check:\n- ${problems.join("\n- ")}`);
  }
  const rows = lexicalUnitRows(data, owner);
  if (rows.length > 0) {
    await db
      .insert(words)
      .values(rows)
      .onConflictDoUpdate({
        target: [words.lemma, words.pos],
        set: {
          unitType: sql`excluded.unit_type`,
          cefrLevel: sql`excluded.cefr_level`,
          details: sql`excluded.details`,
          source: sql`excluded.source`,
          curriculumIndex: sql`excluded.curriculum_index`,
          translationRu: sql`excluded.translation_ru`,
          example: sql`excluded.example`,
        },
      });
  }
  return {
    phrasal_verb: data.phrasalVerbs.length,
    collocation: data.collocations.length,
    idiom: data.idioms.length,
    word_family: data.wordFamilies.length,
  };
}
