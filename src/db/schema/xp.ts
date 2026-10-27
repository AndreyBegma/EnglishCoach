import { index, integer, jsonb, pgEnum, pgTable, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/** What an XP award was for (`src/gamification/xp.ts` holds the rule of each). */
export const xpSourceEnum = pgEnum("xp_source", [
  "grammar_item",
  "review",
  "word_learned",
  "talk_turn",
  "topic_mastered",
  "daily_goal",
  "streak",
]);

export type XpSource = (typeof xpSourceEnum.enumValues)[number];

/**
 * The XP ledger: one row per award, never updated. Server-owned: only `awardXp` writes here, from
 * amounts the rules computed. `meta` says what the award was for (topic id, card id, streak day).
 */
export const xpEvents = pgTable(
  "xp_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: xpSourceEnum().notNull(),
    amount: integer().notNull(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("xp_events_user_id_created_at_idx").on(table.userId, table.createdAt)],
);

export type XpEventRow = typeof xpEvents.$inferSelect;

/** A cache of the ledger: the learner's XP total and the profile level it reaches. */
export const userXp = pgTable("user_xp", {
  userId: integer()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  total: integer().notNull().default(0),
  level: integer().notNull().default(1),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type UserXpRow = typeof userXp.$inferSelect;
