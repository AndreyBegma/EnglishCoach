import { date, integer, pgEnum, pgTable, smallint, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * The learner's streak protection (`src/progress/streak-rules.ts` holds the rules). Server-owned:
 * written only by the streak settle, the restore check and a freeze purchase.
 */
export const userStreak = pgTable("user_streak", {
  userId: integer()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Freezes in stock, 0..`MAX_FREEZES`. */
  freezes: smallint().notNull().default(0),
  /** Learner-local Monday of the last week whose free freeze was granted. */
  grantedWeek: date({ mode: "string" }),
  /** Learner-local day through which missed days were already judged. */
  settledThrough: date({ mode: "string" }),
  /** XP spent on freezes; spendable XP is `user_xp.total` minus this, so the level never drops. */
  xpSpent: integer().notNull().default(0),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type UserStreakRow = typeof userStreak.$inferSelect;

/** How a missed day was kept: a freeze bridged it, or a double goal the next day restored it. */
export const streakDayKindEnum = pgEnum("streak_day_kind", ["freeze", "restore"]);

export type StreakDayKind = (typeof streakDayKindEnum.enumValues)[number];

/** Missed days that still keep the streak, one row per learner-local day, never updated. */
export const streakDays = pgTable(
  "streak_days",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    kind: streakDayKindEnum().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("streak_days_user_id_date_unique").on(table.userId, table.date)],
);

export type StreakDayRow = typeof streakDays.$inferSelect;
