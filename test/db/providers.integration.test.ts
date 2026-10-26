import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import {
  activateProviderConfig,
  getActiveProviderConfig,
  providerKeyHint,
} from "../../src/db/repositories/providers";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { providerConfigs } from "../../src/db/schema";
import type { ProviderFactories } from "../../src/llm/providers/factories";
import { resolveProvider } from "../../src/llm/resolve";
import type { LlmProvider } from "../../src/llm/types";
import { createTestDatabase, testServerUrl } from "./test-database";

const masterKey = randomBytes(32);
const apiKey = "sk-ant-api03-integration-key-9f8e";

describe.skipIf(!testServerUrl)("provider repository and resolveProvider", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  test("stores the key encrypted and shows only a masked hint", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 3001 });
    const config = await activateProviderConfig(
      database.db,
      user.id,
      { kind: "anthropic", apiKey, model: "claude-opus-5-5" },
      masterKey,
    );

    expect(config.isActive).toBe(true);
    expect(config.encryptedApiKey?.toString("utf8")).not.toContain("integration");
    expect(config.keyIv).toHaveLength(12);
    expect(config.keyTag).toHaveLength(16);
    expect(providerKeyHint(config, masterKey)).toBe("sk-…9f8e");
    expect((await getActiveProviderConfig(database.db, user.id))?.id).toBe(config.id);
  });

  test("activating another provider deactivates the old one and replaces the same kind", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 3002 });
    await activateProviderConfig(database.db, user.id, { kind: "anthropic", apiKey }, masterKey);
    await activateProviderConfig(
      database.db,
      user.id,
      {
        kind: "openai",
        apiKey: "sk-or-v1-router-key-7777",
        baseUrl: "https://openrouter.ai/api/v1",
      },
      masterKey,
    );
    await activateProviderConfig(
      database.db,
      user.id,
      { kind: "openai", apiKey: "sk-or-v1-router-key-8888" },
      masterKey,
    );

    const rows = await database.db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.userId, user.id));
    expect(rows.map((row) => [row.kind, row.isActive]).sort()).toEqual([
      ["anthropic", false],
      ["openai", true],
    ]);
    const active = await getActiveProviderConfig(database.db, user.id);
    expect(active?.baseUrl).toBeNull();
    expect(active && providerKeyHint(active, masterKey)).toBe("sk-…8888");
  });

  test("resolveProvider: no config is server, a BYOK config gets its decrypted key", async () => {
    const built: { backend: string; apiKey?: string }[] = [];
    const stub = (backend: string, kind: LlmProvider["kind"]) => (options: object) => {
      built.push({ backend, apiKey: "apiKey" in options ? String(options.apiKey) : undefined });
      return { kind, complete: async () => ({ data: undefined as never }) };
    };
    const factories: ProviderFactories = {
      anthropic: stub("anthropic", "anthropic"),
      openai: stub("openai", "openai"),
      claudeCode: stub("claude-code", "claude-code"),
    };
    const deps = {
      db: database.db,
      masterKey,
      factories,
      env: {
        SERVER_LLM_PROVIDER: "claude-code" as const,
        SERVER_ANTHROPIC_API_KEY: undefined,
        SERVER_OPENAI_API_KEY: undefined,
        SERVER_OPENAI_BASE_URL: undefined,
        SERVER_DEFAULT_MODEL: undefined,
        CLAUDE_BIN: "claude",
      },
    };

    const fresh = await getOrCreateUser(database.db, { telegramId: 3003 });
    expect((await resolveProvider(deps, fresh.id)).kind).toBe("server");

    await activateProviderConfig(database.db, fresh.id, { kind: "anthropic", apiKey }, masterKey);
    expect((await resolveProvider(deps, fresh.id)).kind).toBe("anthropic");
    expect(built.at(-1)).toEqual({ backend: "anthropic", apiKey });
  });
});
