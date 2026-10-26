import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import {
  findUserByTelegramId,
  getOrCreateUser,
  getSettings,
  listAllowedUsers,
  setAllowed,
} from "../../src/db/repositories/users";
import { createTestDatabase, testServerUrl } from "./test-database";

describe.skipIf(!testServerUrl)("users repository — allowlist", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  test("finds nothing for an unknown Telegram ID", async () => {
    expect(await findUserByTelegramId(database.db, 9999)).toBeUndefined();
  });

  test("allowing an unknown ID creates a bare user whose settings come on first contact", async () => {
    const allowed = await setAllowed(database.db, 5001, true);
    expect(allowed).toMatchObject({ telegramId: 5001, isAllowed: true });
    expect(await getSettings(database.db, allowed?.id ?? 0)).toBeUndefined();

    const user = await getOrCreateUser(database.db, { telegramId: 5001, lang: "uk" });
    expect(user).toMatchObject({ id: allowed?.id, isAllowed: true });
    expect(await getSettings(database.db, user.id)).toMatchObject({ uiLang: "uk" });
  });

  test("denying an unknown ID creates nothing", async () => {
    expect(await setAllowed(database.db, 5002, false)).toBeUndefined();
    expect(await findUserByTelegramId(database.db, 5002)).toBeUndefined();
  });

  test("deny then allow flips the flag and listAllowedUsers follows it", async () => {
    await setAllowed(database.db, 5003, true);
    expect((await listAllowedUsers(database.db)).map((u) => u.telegramId)).toContain(5003);

    expect(await setAllowed(database.db, 5003, false)).toMatchObject({ isAllowed: false });
    expect((await listAllowedUsers(database.db)).map((u) => u.telegramId)).not.toContain(5003);
  });
});
