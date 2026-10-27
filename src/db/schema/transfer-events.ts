import { bigint, index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { learningSessions } from "./sessions";
import { users } from "./users";

/** A correct use of a syllabus topic, or an error against it. */
export const transferKindEnum = pgEnum("transfer_kind", ["correct", "error"]);

/** The free-production practice a transfer event came from. */
export const transferSourceEnum = pgEnum("transfer_source", ["talk", "writing", "speaking"]);

export type TransferKind = (typeof transferKindEnum.enumValues)[number];
export type TransferSource = (typeof transferSourceEnum.enumValues)[number];

/**
 * Syllabus topics as the correction skills tagged them in free production, one row per topic per
 * corrected message: the evidence behind a topic's mastery and what the topic screen shows.
 * Server-owned: only `recordTransfer` writes here. `topic_id` is validated against the syllabus.
 */
export const transferEvents = pgTable(
  "transfer_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: text().notNull(),
    kind: transferKindEnum().notNull(),
    source: transferSourceEnum().notNull(),
    /** The practice session the message was in; kept as history when the session goes. */
    sessionId: integer().references(() => learningSessions.id, { onDelete: "set null" }),
    /** The learner's Telegram message that was corrected; null when there was none. */
    messageId: bigint({ mode: "number" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("transfer_events_user_id_topic_id_idx").on(table.userId, table.topicId)],
);

export type TransferEventRow = typeof transferEvents.$inferSelect;
