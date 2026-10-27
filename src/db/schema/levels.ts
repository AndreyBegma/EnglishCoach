import {
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const skillEnum = pgEnum("skill", [
  "grammar",
  "vocabulary",
  "reading",
  "listening",
  "writing",
  "speaking",
]);

export type Skill = (typeof skillEnum.enumValues)[number];

/**
 * The learner's level per skill (`src/levels/`): a continuous rating on the CEFR scale (A1.0 = 0,
 * B1.6 = 2.6, C2.9 = 5.9) and how unsure the model still is about it. Server-owned: only
 * `recordGradedItem` and `seedLevels` write here. `user_settings.cefr_level` is derived from it.
 */
export const skillLevels = pgTable(
  "skill_levels",
  {
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skill: skillEnum().notNull(),
    rating: doublePrecision().notNull(),
    /** Standard deviation of the rating, in the same units; shrinks with evidence. */
    uncertainty: doublePrecision().notNull(),
    /** Graded items behind the rating since it was last seeded. */
    evidence: integer().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.skill] })],
);

export type SkillLevelRow = typeof skillLevels.$inferSelect;
