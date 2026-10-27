import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { cefrLevelEnum } from "./enums";
import { type CardExample, words } from "./vocabulary";

/** `example_sentences.source` of a sentence imported from the Tatoeba export (CC BY 2.0 FR). */
export const TATOEBA_SOURCE = "tatoeba";

/** A human translation of an example sentence, with what its attribution needs. */
export type ExampleTranslation = { id: number; text: string; author: string | null };

/** The languages an example sentence is translated into, keyed by explanation language. */
export type ExampleTranslations = Partial<Record<"ru" | "uk", ExampleTranslation>>;

/**
 * Human-written English example sentences with their translations, imported from an open corpus
 * (`bun run db:import:tatoeba`). Preferred over model-written examples on a word card. The import
 * owns every row of its source: a rerun upserts by `source_id` and removes what is gone.
 */
export const exampleSentences = pgTable(
  "example_sentences",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    source: text().notNull(),
    /** The sentence's id at its source: the Tatoeba sentence number. */
    sourceId: integer().notNull(),
    text: text().notNull(),
    /** The highest dictionary level among the sentence's words: an estimate, not a grading. */
    cefrLevel: cefrLevelEnum().notNull(),
    wordCount: smallint().notNull(),
    /** The contributor's username at the source; null when the sentence has no owner there. */
    author: text(),
    translations: jsonb().$type<ExampleTranslations>().notNull(),
    importedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("example_sentences_source_unique").on(table.source, table.sourceId)],
);

/** Which dictionary words a sentence shows (any inflection): the lemma links. */
export const exampleSentenceWords = pgTable(
  "example_sentence_words",
  {
    wordId: integer()
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    sentenceId: integer()
      .notNull()
      .references(() => exampleSentences.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.wordId, table.sentenceId] }),
    index("example_sentence_words_sentence_idx").on(table.sentenceId),
  ],
);

/** Where a card's example came from, for the caption's attribution. Absent: the model wrote it. */
export type ExampleCredit = { source: typeof TATOEBA_SOURCE; id: number; author: string | null };

/**
 * A card example that may carry its credit. Stored in the same jsonb as `CardExample`, so rows
 * written before credits existed read as model-written.
 */
export type CreditedExample = CardExample & { credit?: ExampleCredit };

/** The credit of a stored example, if it came from a corpus. */
export function exampleCredit(example: CardExample | string): ExampleCredit | undefined {
  return typeof example === "string" ? undefined : (example as CreditedExample).credit;
}

export type ExampleSentenceRow = typeof exampleSentences.$inferSelect;
