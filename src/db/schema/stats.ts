import { boolean, date, integer, pgTable, unique } from "drizzle-orm/pg-core";
import { users } from "./users";

export const dailyStats = pgTable(
  "daily_stats",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The learner's local calendar date (their timezone), as YYYY-MM-DD.
    date: date({ mode: "string" }).notNull(),
    newWords: integer().notNull().default(0),
    reviews: integer().notNull().default(0),
    grammarAnswered: integer().notNull().default(0),
    grammarCorrect: integer().notNull().default(0),
    goalMet: boolean().notNull().default(false),
  },
  (table) => [unique("daily_stats_user_id_date_unique").on(table.userId, table.date)],
);

export type DailyStats = typeof dailyStats.$inferSelect;
