import { asc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type Language, type User, type UserSettings, userSettings, users } from "../schema";

export type TelegramProfile = {
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  /** UI and explanation language for a new user. Ignored when the user already exists. */
  lang?: Language;
};

/**
 * Returns the user for a Telegram ID, creating it (with default settings) on first contact.
 * An existing user gets its username / first name refreshed; its settings are never touched.
 */
export async function getOrCreateUser(db: Db, profile: TelegramProfile): Promise<User> {
  const username = profile.username ?? null;
  const firstName = profile.firstName ?? null;

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ telegramId: profile.telegramId, username, firstName })
      .onConflictDoUpdate({ target: users.telegramId, set: { username, firstName } })
      .returning();
    if (!user) throw new Error("upsert of users returned no row");

    await tx
      .insert(userSettings)
      .values({ userId: user.id, uiLang: profile.lang, explainLang: profile.lang })
      .onConflictDoNothing({ target: userSettings.userId });

    return user;
  });
}

export async function getUserById(db: Db, id: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function findUserByTelegramId(db: Db, telegramId: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
  return user;
}

/**
 * Sets the allowlist flag for a Telegram ID. Allowing an unknown ID creates a bare user row; its
 * settings are created by `getOrCreateUser` on first contact, so they pick up the user's language.
 * Denying an unknown ID creates nothing and returns undefined.
 */
export async function setAllowed(
  db: Db,
  telegramId: number,
  allowed: boolean,
): Promise<User | undefined> {
  if (!allowed) {
    const [user] = await db
      .update(users)
      .set({ isAllowed: false })
      .where(eq(users.telegramId, telegramId))
      .returning();
    return user;
  }

  const [user] = await db
    .insert(users)
    .values({ telegramId, isAllowed: true })
    .onConflictDoUpdate({ target: users.telegramId, set: { isAllowed: true } })
    .returning();
  if (!user) throw new Error("upsert of users returned no row");
  return user;
}

export async function listAllowedUsers(db: Db): Promise<User[]> {
  return db.select().from(users).where(eq(users.isAllowed, true)).orderBy(asc(users.id));
}

export async function getSettings(db: Db, userId: number): Promise<UserSettings | undefined> {
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return settings;
}

export type SettingsPatch = Partial<Omit<typeof userSettings.$inferInsert, "userId">>;

/** Applies a partial update and returns the new settings, or undefined when the user has none. */
export async function updateSettings(
  db: Db,
  userId: number,
  patch: SettingsPatch,
): Promise<UserSettings | undefined> {
  if (Object.values(patch).every((value) => value === undefined)) return getSettings(db, userId);

  const [settings] = await db
    .update(userSettings)
    .set(patch)
    .where(eq(userSettings.userId, userId))
    .returning();
  return settings;
}
