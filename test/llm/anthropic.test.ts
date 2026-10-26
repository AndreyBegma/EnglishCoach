import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { LlmOutputError, LlmProviderError } from "../../src/llm/errors";
import { CURATED_MODELS } from "../../src/llm/models";
import { type AnthropicClient, createAnthropicProvider } from "../../src/llm/providers/anthropic";

const apiKey = "sk-ant-api03-secretsecretsecret-a1b2";
const schema = z.object({ word: z.string(), level: z.enum(["A1", "A2"]) });

type CreateParams = Parameters<AnthropicClient["messages"]["create"]>[0];

function fakeClient(options: {
  inputs?: unknown[];
  createError?: Error;
  models?: string[] | Error;
}) {
  const calls: CreateParams[] = [];
  const client: AnthropicClient = {
    messages: {
      create: async (params) => {
        calls.push(params);
        if (options.createError) throw options.createError;
        return {
          content: [
            { type: "text" },
            { type: "tool_use", name: "respond", input: options.inputs?.[calls.length - 1] },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        };
      },
    },
    models: {
      list: () =>
        (async function* () {
          if (options.models instanceof Error) throw options.models;
          for (const id of options.models ?? []) yield { id };
        })(),
    },
  };
  return { client, calls };
}

const request = {
  system: "You are a coach.",
  messages: [{ role: "user" as const, content: "Give me a word" }],
  schema,
};

describe("anthropic provider", () => {
  test("forces the respond tool with the zod-derived schema and returns its input", async () => {
    const { client, calls } = fakeClient({ inputs: [{ word: "cat", level: "A1" }] });
    const provider = createAnthropicProvider({ apiKey, client });

    const result = await provider.complete({ ...request, maxTokens: 300 });

    expect(provider.kind).toBe("anthropic");
    expect(result).toEqual({
      data: { word: "cat", level: "A1" },
      usage: { input: 100, output: 20 },
    });
    const params = calls[0];
    expect(params?.tool_choice).toEqual({ type: "tool", name: "respond" });
    expect(params?.tools[0]?.input_schema).toMatchObject({
      type: "object",
      required: ["word", "level"],
    });
    expect(params?.system).toBe("You are a coach.");
    expect(params?.max_tokens).toBe(300);
    expect(params?.model).toBe("claude-sonnet-5-5");
  });

  test("passes temperature only when the request sets it", async () => {
    const { client, calls } = fakeClient({
      inputs: [
        { word: "a", level: "A1" },
        { word: "b", level: "A1" },
      ],
    });
    const provider = createAnthropicProvider({ apiKey, client });
    await provider.complete({ ...request, temperature: 0.2 });
    await provider.complete(request);
    expect(calls[0]?.temperature).toBe(0.2);
    expect(calls[1]).not.toHaveProperty("temperature");
  });

  test("the user's model wins over the request model and the tier", async () => {
    const { client, calls } = fakeClient({ inputs: [{ word: "a", level: "A1" }] });
    await createAnthropicProvider({ apiKey, client, model: "claude-opus-5-5" }).complete({
      ...request,
      model: "other",
      tier: "fast",
    });
    expect(calls[0]?.model).toBe("claude-opus-5-5");

    const tiered = fakeClient({ inputs: [{ word: "a", level: "A1" }] });
    await createAnthropicProvider({ apiKey, client: tiered.client }).complete({
      ...request,
      tier: "fast",
    });
    expect(tiered.calls[0]?.model).toBe("claude-haiku-5-5");
  });

  test("repairs invalid tool input once", async () => {
    const { client, calls } = fakeClient({
      inputs: [
        { word: "cat", level: "C2" },
        { word: "cat", level: "A2" },
      ],
    });
    const result = await createAnthropicProvider({ apiKey, client }).complete(request);

    expect(result.data).toEqual({ word: "cat", level: "A2" });
    expect(result.usage).toEqual({ input: 200, output: 40 });
    expect(calls[1]?.messages.at(-1)?.content).toContain("Your previous output failed validation");
  });

  test("throws LlmOutputError when the repair fails too", async () => {
    const { client, calls } = fakeClient({ inputs: [{}, { word: 1 }] });
    await expect(createAnthropicProvider({ apiKey, client }).complete(request)).rejects.toThrow(
      LlmOutputError,
    );
    expect(calls).toHaveLength(2);
  });

  test("wraps SDK errors without leaking the key", async () => {
    const sdkError = Object.assign(new Error(`401 invalid x-api-key ${apiKey}`), { status: 401 });
    const { client } = fakeClient({ createError: sdkError });
    const error = await createAnthropicProvider({ apiKey, client })
      .complete(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).status).toBe(401);
    expect((error as Error).message).not.toContain(apiKey);
    expect((error as Error).message).toContain("[redacted]");
  });

  test("listModels returns the live list, and the curated list on error or emptiness", async () => {
    const live = fakeClient({ models: ["claude-sonnet-5-5", "claude-haiku-5-5"] });
    expect(await createAnthropicProvider({ apiKey, client: live.client }).listModels?.()).toEqual([
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);

    const failing = fakeClient({ models: new Error("503") });
    expect(
      await createAnthropicProvider({ apiKey, client: failing.client }).listModels?.(),
    ).toEqual(CURATED_MODELS.anthropic);

    const empty = fakeClient({ models: [] });
    expect(await createAnthropicProvider({ apiKey, client: empty.client }).listModels?.()).toEqual(
      CURATED_MODELS.anthropic,
    );
  });
});
