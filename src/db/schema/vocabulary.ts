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
import { cardItemTypeEnum, cefrLevelEnum } from "./enums";
import { users } from "./users";

/** The seeded CEFR-levelled frequency dictionary. */
export const words = pgTable(
  "words",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    lemma: text().notNull(),
    pos: text().notNull(),
    cefrLevel: cefrLevelEnum().notNull(),
    frequencyRank: integer(),
    source: text().notNull(),
  },
  (table) => [unique("words_lemma_pos_unique").on(table.lemma, table.pos)],
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
  examples?: CardExample[];
  collocations?: string[];
  mnemonic?: string;
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
