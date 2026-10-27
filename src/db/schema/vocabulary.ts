import { sql } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { cardItemTypeEnum, cefrLevelEnum, lexicalUnitTypeEnum } from "./enums";
import { users } from "./users";

/** `words.source` of a word imported from the owner's curated list (see `src/words/owner-list.ts`). */
export const OWNER_LIST_SOURCE = "owner_list";

/**
 * What an exercise needs to know about a lexical unit beyond its text (see `src/words/lexical.ts`):
 * a phrasal verb's verb and particle, the collocation word the learner supplies, a word family's
 * forms. Idioms carry none.
 */
export type LexicalDetails =
  | { kind: "phrasal_verb"; verb: string; particle: string }
  | { kind: "collocation"; partner: string }
  | { kind: "word_family"; forms: { pos: string; form: string }[] };

/**
 * The seeded CEFR-levelled frequency dictionary, overlaid by the owner's curated list. Owner rows
 * (`source = owner_list`) carry the owner's level, fields and a curriculum position; the picker
 * follows that order. The owner's words are committed under `seed/` without their example
 * sentences (dictionary text); those arrive only from the private workbook import.
 */
export const words = pgTable(
  "words",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    lemma: text().notNull(),
    /**
     * Comma-separated for an owner word listed with several parts of speech; "" when unknown. A
     * lexical unit's is its type name (`phrasal verb`), so `decide` the verb and `decide` the word
     * family are separate rows.
     */
    pos: text().notNull(),
    /** A word, or a lexical unit (`data/lexical/`): its cards take this as their item type. */
    unitType: lexicalUnitTypeEnum().notNull().default("word"),
    /** A lexical unit's exercise data; null for words and idioms. */
    details: jsonb().$type<LexicalDetails>(),
    cefrLevel: cefrLevelEnum().notNull(),
    frequencyRank: integer(),
    source: text().notNull(),
    topic: text(),
    /** The owner's transcription; the fallback behind the dictionary IPA (see `src/words/pronunciation.ts`). */
    ipa: text(),
    /** Dictionary IPA, General American (CMUdict, Wiktionary fallback); null when no source has it. */
    ipaUs: text(),
    /** Dictionary IPA, British (Wiktionary); null when no source has it. */
    ipaUk: text(),
    /** Written syllables joined by `·` (`wa·ter`); null when they could not be checked against a dictionary. */
    syllables: text(),
    /** 0-based index into `syllables` of the syllable with primary stress. */
    stressIndex: smallint(),
    /** The owner's example sentence (English, untranslated). */
    example: text(),
    translationRu: text(),
    /** Owner list sheet: 0 = the A1–A2 check, 1–3 = B1–C1, 4–6 = the rare bands. */
    curriculumStage: smallint(),
    /** Row number (№) inside the sheet. */
    curriculumIndex: integer(),
  },
  (table) => [
    unique("words_lemma_pos_unique").on(table.lemma, table.pos),
    index("words_lemma_idx").on(table.lemma),
    index("words_curriculum_idx").on(table.curriculumStage, table.curriculumIndex),
    index("words_unit_type_level_idx").on(table.unitType, table.cefrLevel),
  ],
);

/** An example sentence on a card and its translation into the learner's language. */
export type CardExample = { en: string; translation: string };

/**
 * LLM enrichment of a card; validated with zod before it is stored. Generated once per card, so
 * a card with a filled back never calls the LLM for it again.
 */
export type CardBack = {
  translation?: string;
  ipa?: string;
  pos?: string;
  /** Word cards store sentences with translations; grammar-pattern cards plain corrected sentences. */
  examples?: (CardExample | string)[];
  collocations?: string[];
  mnemonic?: string;
  /** A stock-photo query for the card's picture; null or absent: no picture. */
  imageQuery?: string | null;
  /** An abstract word's emoji, shown in place of a picture. */
  emoji?: string | null;
  /** A lexical unit's details, copied from its `words` row when the card is created. */
  unit?: LexicalDetails;
};

/** FSRS state columns, 1:1 with the ts-fsrs 5 `Card` (see `src/db/fsrs.ts`). */
export const cards = pgTable(
  "cards",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemType: cardItemTypeEnum().notNull(),
    wordId: integer().references(() => words.id, { onDelete: "restrict" }),
    front: text().notNull(),
    backJson: jsonb().$type<CardBack>().notNull().default({}),
    due: timestamp({ withTimezone: true }).notNull(),
    stability: doublePrecision().notNull(),
    difficulty: doublePrecision().notNull(),
    elapsedDays: integer().notNull(),
    scheduledDays: integer().notNull(),
    learningSteps: integer().notNull(),
    reps: integer().notNull(),
    lapses: integer().notNull(),
    // ts-fsrs `State`: 0 New, 1 Learning, 2 Review, 3 Relearning.
    state: smallint().notNull(),
    lastReview: timestamp({ withTimezone: true }),
    /**
     * Set when the learner marked the word "I know this 100%": the card is never offered as new,
     * never reviewed and never due. Orthogonal to FSRS (the state columns stay untouched), so
     * returning the word to learning is just clearing it.
     */
    knownAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cards_user_id_due_idx").on(table.userId, table.due),
    uniqueIndex("cards_user_id_word_id_unique")
      .on(table.userId, table.wordId)
      .where(sql`${table.wordId} is not null`),
  ],
);

/** One row per review, 1:1 with the ts-fsrs 5 `ReviewLog`. */
export const reviewLogs = pgTable(
  "review_logs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    cardId: integer()
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    // ts-fsrs `Rating`: 0 Manual, 1 Again, 2 Hard, 3 Good, 4 Easy.
    rating: smallint().notNull(),
    state: smallint().notNull(),
    due: timestamp({ withTimezone: true }).notNull(),
    stability: doublePrecision().notNull(),
    difficulty: doublePrecision().notNull(),
    elapsedDays: integer().notNull(),
    lastElapsedDays: integer().notNull(),
    scheduledDays: integer().notNull(),
    learningSteps: integer().notNull(),
    reviewedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index("review_logs_card_id_reviewed_at_idx").on(table.cardId, table.reviewedAt)],
);

export type Word = typeof words.$inferSelect;
export type CardRow = typeof cards.$inferSelect;
export type ReviewLogRow = typeof reviewLogs.$inferSelect;
