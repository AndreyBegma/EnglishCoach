import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Callback, encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { getActiveProviderConfig, listProviderConfigs } from "../../src/db/repositories/providers";
import { findUserByTelegramId } from "../../src/db/repositories/users";
import type { ProviderFactories } from "../../src/llm";
import { type AnthropicClient, createAnthropicProvider } from "../../src/llm/providers/anthropic";
import { createOpenAiProvider, type OpenAiClient } from "../../src/llm/providers/openai";
import { createHarness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const GOOD_KEY = "sk-ant-api03-real-path-good-key-1111";
const BAD_KEY = "sk-ant-api03-real-path-bad-key-2222";

/** An SDK models listing that behaves like the API: 401 for a wrong key, echoing it back. */
function models(apiKey: string) {
  return {
    list: async function* () {
      if (apiKey !== GOOD_KEY) {
        throw Object.assign(new Error(`401 {"error":"invalid x-api-key ${apiKey}"}`), {
          status: 401,
        });
      }
      yield { id: "claude-sonnet-5-5" };
    },
  };
}

const unused = () => {
  throw new Error("not used by this test");
};

const badRequest = (message: string) => Object.assign(new Error(`400 ${message}`), { status: 400 });

/**
 * Messages as Claude 5.5 models answer under API version 2026-10-21: forced tool use and sampling
 * parameters are a 400; `output_config.format` returns the JSON as a text block.
 */
const create: AnthropicClient["messages"]["create"] = async (params) => {
  if (params.tool_choice) {
    throw badRequest('tool_choice: type "tool" and "any" are not supported for this model.');
  }
  if ("temperature" in params) throw badRequest("temperature: Extra inputs are not permitted");
  if (params.output_config?.format.type !== "json_schema") return unused();
  // Adaptive thinking spends part of the budget before the answer.
  if (params.max_tokens < 256) {
    return { content: [{ type: "thinking" }], usage: { input_tokens: 30, output_tokens: 32 } };
  }
  return {
    content: [{ type: "thinking" }, { type: "text", text: '{"ok": true}' }],
    usage: { input_tokens: 30, output_tokens: 90 },
  };
};

/** The real providers (and their error handling) over fake SDK clients. */
const realProviders: ProviderFactories = {
  anthropic: (options) =>
    createAnthropicProvider({
      ...options,
      client: { messages: { create }, models: models(options.apiKey) },
    }),
  openai: (options) =>
    createOpenAiProvider({
      ...options,
      client: {
        chat: { completions: { create: unused } },
        models: models(options.apiKey),
      } as OpenAiClient,
    }),
  claudeCode: unused,
};

describe.skipIf(!testServerUrl)("key validation through the real provider code", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  test.each(["anthropic", "openai"] as const)(
    "%s: an HTTP 401 from the model listing rejects the key; nothing is stored or leaked",
    async (choice) => {
      const telegramId = 920_000 + (choice === "anthropic" ? 1 : 2);
      const h = createHarness(database.db, {
        adminIds: [telegramId],
        llmFactories: realProviders,
      });
      // `/start` would begin onboarding for a learner without a level; this test starts at the hub.
      await h.say(telegramId, "/menu");
      const user = await findUserByTelegramId(database.db, telegramId);
      const hub = user && (await getHub(database.db, user.id));
      if (!user || !hub) throw new Error("user or hub not created");
      const press = () =>
        h.press(telegramId, hub.messageId, encodeCallback({ type: "provider", choice }));
      const hubText = () => h.telegram.chat(telegramId).get(hub.messageId)?.text ?? "";

      await press();
      await h.say(telegramId, BAD_KEY);
      expect(hubText()).toContain("The provider rejected this key.");
      expect(await listProviderConfigs(database.db, user.id)).toEqual([]);
      expect(JSON.stringify(h.telegram.calls)).not.toContain(BAD_KEY);
      expect(h.logs.join("\n")).not.toContain(BAD_KEY);
      expect(h.logs.join("\n")).toContain('"status":401');

      await h.say(telegramId, GOOD_KEY);
      expect((await getActiveProviderConfig(database.db, user.id))?.kind).toBe(choice);
      expect(hubText()).toContain("Key checked and saved.");
    },
  );

  test("anthropic: Test provider succeeds with a valid key on a Claude 5.5 model", async () => {
    const telegramId = 920_003;
    const h = createHarness(database.db, { adminIds: [telegramId], llmFactories: realProviders });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    const hub = user && (await getHub(database.db, user.id));
    if (!user || !hub) throw new Error("user or hub not created");
    const press = (callback: Callback) =>
      h.press(telegramId, hub.messageId, encodeCallback(callback));
    const hubText = () => h.telegram.chat(telegramId).get(hub.messageId)?.text ?? "";

    await press({ type: "provider", choice: "anthropic" });
    await h.say(telegramId, GOOD_KEY);
    await press({ type: "provider-test" });
    expect(hubText()).toMatch(/Provider works \(\d+ ms\)/);
  });
});
