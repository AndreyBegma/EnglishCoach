import { bigint, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * The learner's achievement metrics (`src/gamification/achievements/`): one counter per metric,
 * raised by domain events. Server-owned: only the achievements evaluator writes here. Metrics with
 * a `:` are internal state (a running answer streak, the current session's items), not catalogue
 * metrics.
 */
export const achievementProgress = pgTable(
  "achievement_progress",
  {
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metric: text().notNull(),
    value: bigint({ mode: "number" }).notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.metric] })],
);

export type AchievementProgressRow = typeof achievementProgress.$inferSelect;

/**
 * Unlocked achievements, one row per learner and catalogue id; the primary key is what makes an
 * unlock (and its XP) happen once. `notifiedAt` is set when the hub has shown the unlock.
 */
export const userAchievements = pgTable(
  "user_achievements",
  {
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    achievementId: text().notNull(),
    unlockedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.achievementId] }),
    index("user_achievements_user_id_unlocked_at_idx").on(table.userId, table.unlockedAt),
  ],
);

export type UserAchievementRow = typeof userAchievements.$inferSelect;
