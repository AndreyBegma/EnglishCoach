import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import { getOrCreateUser, getSettings, updateSettings } from "../../src/db/repositories/users";
import { createTestDatabase, testServerUrl } from "./test-database";

describe.skipIf(!testServerUrl)("users repository", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  test("creates a user with default settings on first contact", async () => {
    const user = await getOrCreateUser(database.db, {
      telegramId: 1001,
      username: "alice",
      firstName: "Alice",
    });

    expect(user).toMatchObject({
      telegramId: 1001,
      username: "alice",
      firstName: "Alice",
      isAllowed: false,
      isAdmin: false,
    });
    expect(await getSettings(database.db, user.id)).toEqual({
      userId: user.id,
      uiLang: "en",
      explainLang: "en",
      cefrLevel: null,
      wordsPerDay: 5,
      timezone: "Europe/Kyiv",
      morningTime: "08:30:00",
      eveningTime: "20:00:00",
      remindersEnabled: true,
      voiceEnabled: false,
      englishVariant: "us",
      goals: [],
      interests: [],
      profession: null,
    });
  });

  test("uses the given language for a new user", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 1002, lang: "uk" });
    expect(await getSettings(database.db, user.id)).toMatchObject({
      uiLang: "uk",
      explainLang: "uk",
    });
  });

  test("returns the same user again, refreshing the profile but not the settings", async () => {
    const first = await getOrCreateUser(database.db, {
      telegramId: 1003,
      username: "bob",
      lang: "ru",
    });
    await updateSettings(database.db, first.id, { wordsPerDay: 10 });

    const second = await getOrCreateUser(database.db, {
      telegramId: 1003,
      username: "bob_renamed",
      firstName: "Bob",
      lang: "en",
    });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ username: "bob_renamed", firstName: "Bob" });
    expect(await getSettings(database.db, first.id)).toMatchObject({
      uiLang: "ru",
      explainLang: "ru",
      wordsPerDay: 10,
    });
  });

  test("updates and reads back settings", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 1004 });

    const updated = await updateSettings(database.db, user.id, {
      cefrLevel: "B1",
      explainLang: "ru",
      timezone: "Europe/Warsaw",
      morningTime: "07:15",
      remindersEnabled: false,
      interests: ["travel", "music"],
    });

    expect(updated).toMatchObject({
      cefrLevel: "B1",
      uiLang: "en",
      explainLang: "ru",
      timezone: "Europe/Warsaw",
      morningTime: "07:15:00",
      remindersEnabled: false,
      interests: ["travel", "music"],
    });
    expect(await getSettings(database.db, user.id)).toEqual(updated);
  });

  test("an empty patch returns the current settings unchanged", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 1005 });
    const before = await getSettings(database.db, user.id);
    expect(await updateSettings(database.db, user.id, {})).toEqual(before);
  });

  test("settings of an unknown user are undefined", async () => {
    expect(await getSettings(database.db, 999_999)).toBeUndefined();
    expect(await updateSettings(database.db, 999_999, { wordsPerDay: 3 })).toBeUndefined();
  });
});
