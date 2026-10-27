import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
} from "drizzle-orm/pg-core";
import { cefrLevelEnum, languageEnum } from "./enums";

/** Why the learner studies English; several may apply. */
export const LEARNER_GOALS = [
  "it",
  "travel",
  "work_business",
  "exam",
  "everyday",
  "relocation",
] as const;
export type LearnerGoal = (typeof LEARNER_GOALS)[number];

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  // Telegram IDs fit in 52 bits, so number mode is lossless.
  telegramId: bigint({ mode: "number" }).notNull().unique("users_telegram_id_unique"),
  username: text(),
  firstName: text(),
  isAllowed: boolean().notNull().default(false),
  isAdmin: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const userSettings = pgTable(
  "user_settings",
  {
    userId: integer()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    uiLang: languageEnum().notNull().default("en"),
    explainLang: languageEnum().notNull().default("en"),
    // Null until the placement test has run. A cache of the overall level's band from
    // `skill_levels` (`src/levels/`): written there, never set on its own.
    cefrLevel: cefrLevelEnum(),
    wordsPerDay: smallint().notNull().default(5),
    timezone: text().notNull().default("Europe/Kyiv"),
    morningTime: time().notNull().default("08:30"),
    eveningTime: time().notNull().default("20:00"),
    remindersEnabled: boolean().notNull().default(true),
    voiceEnabled: boolean().notNull().default(false),
    // Which English the bot pronounces words in.
    englishVariant: text().$type<"us" | "uk">().notNull().default("us"),
    // The learner profile, asked in onboarding and edited in Settings → Profile & goals. Learner
    // text: it reaches skills only inside `<learner_context>`, never the system prompt.
    goals: text().array().$type<LearnerGoal[]>().notNull().default(sql`'{}'::text[]`),
    interests: text().array().notNull().default(sql`'{}'::text[]`),
    profession: text(),
    // The recall probability every FSRS scheduler aims for, in percent (`src/fsrs/`).
    desiredRetention: smallint().notNull().default(90),
  },
  (table) => [
    check("user_settings_english_variant_check", sql`${table.englishVariant} in ('us', 'uk')`),
    check(
      "user_settings_desired_retention_check",
      sql`${table.desiredRetention} between 85 and 95`,
    ),
    check(
      "user_settings_goals_check",
      sql`${table.goals} <@ array[${sql.raw(LEARNER_GOALS.map((goal) => `'${goal}'`).join(", "))}]::text[]`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
