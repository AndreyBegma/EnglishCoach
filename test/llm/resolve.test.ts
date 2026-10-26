import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { encrypt } from "../../src/crypto/secrets";
import type { ProviderConfig } from "../../src/db/schema";
import { PROVIDER_UNAVAILABLE_KEYS, ProviderUnavailableError } from "../../src/llm/errors";
import type { ProviderFactories } from "../../src/llm/providers/factories";
import type { ServerEnv } from "../../src/llm/providers/server";
import { providerFromConfig } from "../../src/llm/resolve";
import type { LlmProvider, ProviderKind } from "../../src/llm/types";

const masterKey = randomBytes(32);

/** Factories that record what they were built with and answer with a fixed payload. */
function recordingFactories() {
  const built: { backend: string; options: Record<string, unknown> }[] = [];
  const make =
    (backend: string, kind: ProviderKind) =>
    (options: object): LlmProvider => {
      built.push({ backend, options: options as Record<string, unknown> });
      return {
        kind,
        complete: async (req) => ({ data: req.schema.parse({ from: backend }) }),
        listModels: async () => [`${backend}-model`],
      };
    };
  const factories: ProviderFactories = {
    anthropic: make("anthropic", "anthropic"),
    openai: make("openai", "openai"),
    claudeCode: make("claude-code", "claude-code"),
  };
  return { factories, built };
}

const env: ServerEnv = {
  SERVER_LLM_PROVIDER: "anthropic",
  SERVER_ANTHROPIC_API_KEY: "sk-ant-server-key-0000",
  SERVER_OPENAI_API_KEY: undefined,
  SERVER_OPENAI_BASE_URL: undefined,
  SERVER_DEFAULT_MODEL: undefined,
  CLAUDE_BIN: "claude",
};

function config(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 1,
    userId: 1,
    kind: "server",
    model: null,
    baseUrl: null,
    encryptedApiKey: null,
    keyIv: null,
    keyTag: null,
    isActive: true,
    updatedAt: new Date(),
    ...overrides,
  };
}

function withKey(apiKey: string): Partial<ProviderConfig> {
  const secret = encrypt(apiKey, masterKey);
  return { encryptedApiKey: secret.ciphertext, keyIv: secret.iv, keyTag: secret.tag };
}

const fromSchema = z.object({ from: z.string() });
const ask = (provider: LlmProvider) =>
  provider.complete({
    system: "s",
    messages: [{ role: "user", content: "u" }],
    schema: fromSchema,
  });

describe("providerFromConfig", () => {
  test("no config means the server provider, delegating to SERVER_LLM_PROVIDER", async () => {
    const { factories, built } = recordingFactories();
    const provider = providerFromConfig(undefined, { env, masterKey, factories });

    expect(provider.kind).toBe("server");
    expect((await ask(provider)).data).toEqual({ from: "anthropic" });
    expect(await provider.listModels?.()).toEqual(["anthropic-model"]);
    expect(built[0]?.options).toEqual({ apiKey: "sk-ant-server-key-0000", model: undefined });
  });

  test("server: openai with base URL and SERVER_DEFAULT_MODEL, and claude-code with CLAUDE_BIN", () => {
    const openai = recordingFactories();
    providerFromConfig(config({ kind: "server" }), {
      env: {
        ...env,
        SERVER_LLM_PROVIDER: "openai",
        SERVER_OPENAI_API_KEY: "sk-server-openai-1111",
        SERVER_OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
        SERVER_DEFAULT_MODEL: "vendor/model",
      },
      masterKey,
      factories: openai.factories,
    });
    expect(openai.built[0]).toEqual({
      backend: "openai",
      options: {
        apiKey: "sk-server-openai-1111",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "vendor/model",
      },
    });

    const cli = recordingFactories();
    providerFromConfig(undefined, {
      env: { ...env, SERVER_LLM_PROVIDER: "claude-code", CLAUDE_BIN: "/opt/claude" },
      masterKey,
      factories: cli.factories,
    });
    expect(cli.built[0]?.options).toEqual({ command: ["/opt/claude"], model: undefined });
  });

  test("an unconfigured server is ProviderUnavailable with the server i18n key", () => {
    const { factories } = recordingFactories();
    for (const broken of [
      { ...env, SERVER_LLM_PROVIDER: undefined },
      { ...env, SERVER_ANTHROPIC_API_KEY: undefined },
      { ...env, SERVER_LLM_PROVIDER: "openai" as const },
    ]) {
      let error: unknown;
      try {
        providerFromConfig(undefined, { env: broken, masterKey, factories });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect((error as ProviderUnavailableError).i18nKey).toBe("provider-unavailable-server");
    }
  });

  test("runner is ProviderUnavailable with the runner i18n key", () => {
    const { factories } = recordingFactories();
    let error: unknown;
    try {
      providerFromConfig(config({ kind: "runner" }), { env, masterKey, factories });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).i18nKey).toBe(PROVIDER_UNAVAILABLE_KEYS.runner);
    expect((error as ProviderUnavailableError).i18nKey).toBe("provider-unavailable-runner");
  });

  test("BYOK anthropic and openai get the decrypted key, the user's model and base URL", () => {
    const { factories, built } = recordingFactories();
    const anthropic = providerFromConfig(
      config({ kind: "anthropic", model: "claude-opus-5-5", ...withKey("sk-ant-user-aaaa") }),
      { env, masterKey, factories },
    );
    const openai = providerFromConfig(
      config({
        kind: "openai",
        model: "gpt-6-luna",
        baseUrl: "https://router.example/v1",
        ...withKey("sk-user-openai-bbbb"),
      }),
      { env, masterKey, factories },
    );

    expect(anthropic.kind).toBe("anthropic");
    expect(openai.kind).toBe("openai");
    expect(built).toEqual([
      { backend: "anthropic", options: { apiKey: "sk-ant-user-aaaa", model: "claude-opus-5-5" } },
      {
        backend: "openai",
        options: {
          apiKey: "sk-user-openai-bbbb",
          baseUrl: "https://router.example/v1",
          model: "gpt-6-luna",
        },
      },
    ]);
  });

  test("claude-code uses CLAUDE_BIN and the user's model", () => {
    const { factories, built } = recordingFactories();
    providerFromConfig(config({ kind: "claude-code", model: "opus" }), {
      env,
      masterKey,
      factories,
    });
    expect(built[0]?.options).toEqual({ command: ["claude"], model: "opus" });
  });

  test("a BYOK config without a key, or under another master key, fails loudly", () => {
    const { factories } = recordingFactories();
    expect(() =>
      providerFromConfig(config({ kind: "anthropic" }), { env, masterKey, factories }),
    ).toThrow("has no API key");
    expect(() =>
      providerFromConfig(config({ kind: "openai", ...withKey("sk-user-cccc") }), {
        env,
        masterKey: randomBytes(32),
        factories,
      }),
    ).toThrow("could not be decrypted");
  });
});
