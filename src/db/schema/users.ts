import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
} from "drizzle-orm/pg-core";
import { cefrLevelEnum, languageEnum } from "./enums";

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

export const userSettings = pgTable("user_settings", {
  userId: integer()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  uiLang: languageEnum().notNull().default("en"),
  explainLang: languageEnum().notNull().default("en"),
  // Null until the placement test has run.
  cefrLevel: cefrLevelEnum(),
  wordsPerDay: smallint().notNull().default(5),
  timezone: text().notNull().default("Europe/Kyiv"),
  morningTime: time().notNull().default("08:30"),
  eveningTime: time().notNull().default("20:00"),
  remindersEnabled: boolean().notNull().default(true),
  voiceEnabled: boolean().notNull().default(false),
  interests: text().array().notNull().default(sql`'{}'::text[]`),
});

export type User = typeof users.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
