import { doublePrecision, integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * A learner's own FSRS parameters, fitted from their review log by the optimiser
 * (`src/fsrs/optimiser.ts`). No row: the ts-fsrs defaults. A row is written on every optimiser run,
 * so `checked_at` paces the monthly re-fit even when the fit was not kept.
 */
export const fsrsParameters = pgTable("fsrs_parameters", {
  userId: integer()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // The FSRS-6 weights in use; null until a fit beat the defaults.
  weights: doublePrecision().array(),
  // Log loss of the weights in use (or the defaults) on the log of the last run.
  logLoss: doublePrecision().notNull(),
  // Reviews in the log of the last run.
  reviewCount: integer().notNull(),
  // When `weights` were last replaced.
  fittedAt: timestamp({ withTimezone: true }),
  checkedAt: timestamp({ withTimezone: true }).notNull(),
});

export type FsrsParametersRow = typeof fsrsParameters.$inferSelect;
