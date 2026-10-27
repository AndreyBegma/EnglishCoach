import { integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { mistakeCategoryEnum } from "./enums";
import { users } from "./users";
import { cards } from "./vocabulary";

/** Recurring error patterns; one row per (user, category, normalised pattern), counted up. */
export const mistakes = pgTable(
  "mistakes",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: mistakeCategoryEnum().notNull(),
    pattern: text().notNull(),
    exampleWrong: text().notNull(),
    exampleRight: text().notNull(),
    explanation: text().notNull(),
    count: integer().notNull().default(1),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // The grammar syllabus topic (`g015`) the pattern belongs to; null when none fits or unknown.
    // Validated against the syllabus before it is written; the syllabus is a file, so no FK.
    topicId: text(),
    // Set when the pattern is promoted to an SRS card.
    cardId: integer().references(() => cards.id, { onDelete: "set null" }),
  },
  (table) => [
    unique("mistakes_user_id_category_pattern_unique").on(
      table.userId,
      table.category,
      table.pattern,
    ),
  ],
);

export type Mistake = typeof mistakes.$inferSelect;
