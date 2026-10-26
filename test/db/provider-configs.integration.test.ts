import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { providerConfigs } from "../../src/db/schema";
import { createTestDatabase, pgErrorCode, testServerUrl, UNIQUE_VIOLATION } from "./test-database";

describe.skipIf(!testServerUrl)("provider_configs", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  test("rejects a second active provider for the same user", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 2001 });
    await database.db
      .insert(providerConfigs)
      .values({ userId: user.id, kind: "server", isActive: true });

    const second = database.db
      .insert(providerConfigs)
      .values({ userId: user.id, kind: "openai", model: "gpt-x", isActive: true });

    expect(pgErrorCode(await second.catch((error: unknown) => error))).toBe(UNIQUE_VIOLATION);
  });

  test("allows any number of inactive providers next to one active one", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 2002 });
    await database.db.insert(providerConfigs).values([
      { userId: user.id, kind: "server", isActive: true },
      { userId: user.id, kind: "anthropic", isActive: false },
      { userId: user.id, kind: "openai", isActive: false },
    ]);

    const rows = await database.db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.userId, user.id));
    expect(rows.filter((row) => row.isActive)).toHaveLength(1);
    expect(rows).toHaveLength(3);
  });

  test("lets different users each have an active provider", async () => {
    const a = await getOrCreateUser(database.db, { telegramId: 2003 });
    const b = await getOrCreateUser(database.db, { telegramId: 2004 });

    await database.db.insert(providerConfigs).values([
      { userId: a.id, kind: "server", isActive: true },
      { userId: b.id, kind: "server", isActive: true },
    ]);
  });

  test("switching the active provider works once the old one is deactivated", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 2005 });
    const [server] = await database.db
      .insert(providerConfigs)
      .values({ userId: user.id, kind: "server", isActive: true })
      .returning();
    if (!server) throw new Error("insert returned no row");

    await database.db.transaction(async (tx) => {
      await tx
        .update(providerConfigs)
        .set({ isActive: false })
        .where(eq(providerConfigs.id, server.id));
      await tx.insert(providerConfigs).values({
        userId: user.id,
        kind: "anthropic",
        encryptedApiKey: Buffer.from([1, 2, 3]),
        keyIv: Buffer.alloc(12),
        keyTag: Buffer.alloc(16),
        isActive: true,
      });
    });

    const [active] = await database.db
      .select()
      .from(providerConfigs)
      .where(and(eq(providerConfigs.userId, user.id), eq(providerConfigs.isActive, true)));
    expect(active?.kind).toBe("anthropic");
    expect(active?.encryptedApiKey).toEqual(Buffer.from([1, 2, 3]));
  });
});
