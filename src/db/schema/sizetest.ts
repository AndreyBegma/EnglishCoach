import { index, integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import { learningSessions } from "./sessions";
import { users } from "./users";

/** One question of a size test, as it was asked. A pseudo-word has `band: null`, `wordId: null`. */
export type SizeTestItem = {
  word: string;
  wordId: number | null;
  band: number | null;
  /** The meanings offered, in the order of the buttons. */
  options: string[];
  /** Index of the right meaning in `options`; null for a pseudo-word (none is right). */
  answer: number | null;
};

/** The learner's choice per item: an option index, or null for "I don't know". */
export type SizeTestAnswer = number | null;

/** The corrected share known per band, as the estimator left it. */
export type SizeTestBand = { band: number; share: number };

/**
 * Finished vocabulary size tests (`src/sizetest/`): the learner's size history. A test in
 * progress lives only in the session's flow state, so a row is written once, at the end, with
 * what was asked, what was answered and the server's estimate.
 */
export const vocabSizeTests = pgTable(
  "vocab_size_tests",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: integer().references(() => learningSessions.id, { onDelete: "set null" }),
    items: jsonb().$type<SizeTestItem[]>().notNull(),
    answers: jsonb().$type<SizeTestAnswer[]>().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    finishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Estimated known words among the 10k most frequent, rounded. */
    estimate: integer().notNull(),
    /** Share of everyday text that size covers, in basis points (9500 = 95%). */
    coverageBp: integer().notNull(),
    bands: jsonb().$type<SizeTestBand[]>().notNull(),
    /** Pseudo-word false-alarm rate in basis points. */
    falseAlarmsBp: integer().notNull(),
  },
  (table) => [index("vocab_size_tests_user_id_finished_at_idx").on(table.userId, table.finishedAt)],
);

export type VocabSizeTestRow = typeof vocabSizeTests.$inferSelect;
