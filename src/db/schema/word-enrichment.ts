import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { languageEnum } from "./enums";
import { type CardExample, words } from "./vocabulary";

/** Lemmas the owner removed on purpose (nationalities, duplicates, inflected forms): never picked. */
export const excludedLemmas = pgTable("excluded_lemmas", {
  lemma: text().primaryKey(),
  reason: text(),
  source: text().notNull(),
});

/** A word's card back in one explanation language, shared by every learner of that language. */
export type WordEnrichmentData = {
  translation: string;
  ipa: string;
  pos: string;
  examples: CardExample[];
  collocations: string[];
  mnemonic: string;
  /** A short English search query for the card's picture. */
  imageQuery: string;
};

/**
 * The shared enrichment cache: filled ahead of time by the prefetch and backfill jobs, read by
 * Learn words, so a card never waits on the LLM. Validated with zod before it is written.
 */
export const wordEnrichments = pgTable(
  "word_enrichments",
  {
    wordId: integer()
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    lang: languageEnum().notNull(),
    data: jsonb().$type<WordEnrichmentData>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.wordId, table.lang] })],
);

export type ExcludedLemma = typeof excludedLemmas.$inferSelect;
export type WordEnrichmentRow = typeof wordEnrichments.$inferSelect;
