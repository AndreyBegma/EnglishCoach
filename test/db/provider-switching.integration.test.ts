import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { Database } from "../../src/db/client";
import {
  activateProviderConfig,
  getActiveProviderConfig,
  listProviderConfigs,
  reactivateProviderConfig,
  setActiveProviderModel,
} from "../../src/db/repositories/providers";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { createTestDatabase, testServerUrl } from "./test-database";

const masterKey = randomBytes(32);

describe.skipIf(!testServerUrl)("switching between saved provider configs", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  const activeCount = async (userId: number) =>
    (await listProviderConfigs(database.db, userId)).filter((config) => config.isActive).length;

  test("reactivating a saved config leaves exactly one active, and keeps the others saved", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 4001 });
    const anthropic = await activateProviderConfig(
      database.db,
      user.id,
      { kind: "anthropic", apiKey: "sk-ant-switch-key-0001" },
      masterKey,
    );
    await activateProviderConfig(database.db, user.id, { kind: "server" }, masterKey);
    expect(await activeCount(user.id)).toBe(1);

    const back = await reactivateProviderConfig(database.db, user.id, anthropic.id);
    expect(back).toMatchObject({ id: anthropic.id, isActive: true });
    expect(await activeCount(user.id)).toBe(1);
    expect((await getActiveProviderConfig(database.db, user.id))?.kind).toBe("anthropic");
    expect((await listProviderConfigs(database.db, user.id)).map((c) => c.kind)).toEqual([
      "anthropic",
      "server",
    ]);
  });

  test("another user's config cannot be reactivated", async () => {
    const owner = await getOrCreateUser(database.db, { telegramId: 4002 });
    const other = await getOrCreateUser(database.db, { telegramId: 4003 });
    const config = await activateProviderConfig(
      database.db,
      owner.id,
      { kind: "anthropic", apiKey: "sk-ant-owner-key-0002" },
      masterKey,
    );
    await activateProviderConfig(database.db, other.id, { kind: "server" }, masterKey);

    expect(await reactivateProviderConfig(database.db, other.id, config.id)).toBeUndefined();
    expect((await getActiveProviderConfig(database.db, other.id))?.kind).toBe("server");
    expect((await getActiveProviderConfig(database.db, owner.id))?.id).toBe(config.id);
  });

  test("the model is set on the active config only", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 4004 });
    expect(await setActiveProviderModel(database.db, user.id, "x")).toBeUndefined();

    await activateProviderConfig(
      database.db,
      user.id,
      { kind: "openai", apiKey: "sk-openai-key-0004" },
      masterKey,
    );
    expect((await setActiveProviderModel(database.db, user.id, "gpt-6-luna"))?.model).toBe(
      "gpt-6-luna",
    );
    expect((await setActiveProviderModel(database.db, user.id, null))?.model).toBeNull();
  });
});
