import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { providerKindEnum } from "./enums";
import { bytea } from "./types";
import { users } from "./users";

export const providerConfigs = pgTable(
  "provider_configs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: providerKindEnum().notNull(),
    model: text(),
    baseUrl: text(),
    // AES-256-GCM under MASTER_KEY; null for providers that carry no user key.
    encryptedApiKey: bytea(),
    keyIv: bytea(),
    keyTag: bytea(),
    isActive: boolean().notNull().default(false),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("provider_configs_user_id_idx").on(table.userId),
    // At most one active provider per user.
    uniqueIndex("provider_configs_one_active_per_user")
      .on(table.userId)
      .where(sql`${table.isActive}`),
  ],
);

export type ProviderConfig = typeof providerConfigs.$inferSelect;
