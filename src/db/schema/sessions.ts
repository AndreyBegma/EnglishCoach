import { bigint, boolean, index, integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import { sessionKindEnum, sessionStatusEnum } from "./enums";
import { users } from "./users";

export const learningSessions = pgTable(
  "learning_sessions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: sessionKindEnum().notNull(),
    status: sessionStatusEnum().notNull().default("active"),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp({ withTimezone: true }),
    summaryJson: jsonb().$type<Record<string, unknown>>(),
  },
  (table) => [index("learning_sessions_user_id_status_idx").on(table.userId, table.status)],
);

/** Every message sent or received inside a session, so cleanup can delete them. */
export const sessionMessages = pgTable(
  "session_messages",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    sessionId: integer()
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    chatId: bigint({ mode: "number" }).notNull(),
    messageId: bigint({ mode: "number" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("session_messages_session_id_idx").on(table.sessionId)],
);

/** The single pinned menu message per user. */
export const hubMessages = pgTable("hub_messages", {
  userId: integer()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  chatId: bigint({ mode: "number" }).notNull(),
  messageId: bigint({ mode: "number" }).notNull(),
  pinned: boolean().notNull().default(false),
});

export type LearningSession = typeof learningSessions.$inferSelect;
export type SessionMessage = typeof sessionMessages.$inferSelect;
export type HubMessage = typeof hubMessages.$inferSelect;
