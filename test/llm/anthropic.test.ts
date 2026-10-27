import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { LlmOutputError, LlmProviderError } from "../../src/llm/errors";
import { CURATED_MODELS } from "../../src/llm/models";
import {
  type AnthropicClient,
  anthropicSchema,
  createAnthropicProvider,
} from "../../src/llm/providers/anthropic";
import { toJsonSchema } from "../../src/llm/structured";
import { outputSchemas } from "../../src/skills/schemas";

const apiKey = "sk-ant-api03-secretsecretsecret-a1b2";
const schema = z.object({ word: z.string(), level: z.enum(["A1", "A2"]) });

type CreateParams = Parameters<AnthropicClient["messages"]["create"]>[0];

/**
 * A fake SDK. Each output is the answer for one call: returned as a JSON text block when the
 * request uses `output_config`, as the `respond` tool's input when it forces the tool.
 * A string output is sent verbatim as text.
 */
function fakeClient(options: {
  outputs?: unknown[];
  createError?: Error;
  models?: string[] | Error;
}) {
  const calls: CreateParams[] = [];
  const client: AnthropicClient = {
    messages: {
      create: async (params) => {
        calls.push(params);
        if (options.createError) throw options.createError;
        const output = options.outputs?.[calls.length - 1];
        const content = params.tool_choice
          ? [
              { type: "text", text: "" },
              { type: "tool_use", name: "respond", input: output },
            ]
          : [
              { type: "thinking" },
              { type: "text", text: typeof output === "string" ? output : JSON.stringify(output) },
            ];
        return { content, usage: { input_tokens: 100, output_tokens: 20 } };
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
  test("asks for output_config json_schema and parses the text block", async () => {
    const { client, calls } = fakeClient({ outputs: [{ word: "cat", level: "A1" }] });
    const provider = createAnthropicProvider({ apiKey, client });

    const result = await provider.complete({ ...request, maxTokens: 300 });

    expect(provider.kind).toBe("anthropic");
    expect(result).toEqual({
      data: { word: "cat", level: "A1" },
      usage: { input: 100, output: 20 },
    });
    const params = calls[0];
    expect(params?.model).toBe("claude-sonnet-5-5");
    expect(params?.output_config?.format).toEqual({
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          word: { type: "string" },
          level: { type: "string", enum: ["A1", "A2"] },
        },
        required: ["word", "level"],
        additionalProperties: false,
      },
    });
    expect(params).not.toHaveProperty("tools");
    expect(params).not.toHaveProperty("tool_choice");
    expect(params?.system).toBe("You are a coach.");
    expect(params?.max_tokens).toBe(300);
  });

  test("leaves room for adaptive thinking when the request sets no max_tokens", async () => {
    const { client, calls } = fakeClient({ outputs: [{ word: "a", level: "A1" }] });
    await createAnthropicProvider({ apiKey, client }).complete(request);
    expect(calls[0]?.max_tokens).toBe(16_000);
  });

  test("never sends temperature: API version 2026-10-21 removed sampling parameters", async () => {
    for (const model of ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-3-7-sonnet-latest"]) {
      const { client, calls } = fakeClient({ outputs: [{ word: "a", level: "A1" }] });
      await createAnthropicProvider({ apiKey, client, model }).complete({
        ...request,
        temperature: 0.2,
      });
      expect(calls[0]).not.toHaveProperty("temperature");
    }
  });

  test("forces the respond tool only for models without structured outputs", async () => {
    const { client, calls } = fakeClient({ outputs: [{ word: "cat", level: "A2" }] });
    const result = await createAnthropicProvider({
      apiKey,
      client,
      model: "claude-3-7-sonnet-latest",
    }).complete(request);

    expect(result.data).toEqual({ word: "cat", level: "A2" });
    const params = calls[0];
    expect(params?.tool_choice).toEqual({ type: "tool", name: "respond" });
    expect(params?.tools?.[0]?.input_schema).toMatchObject({
      type: "object",
      required: ["word", "level"],
      additionalProperties: false,
    });
    expect(params).not.toHaveProperty("output_config");
  });

  test("the user's model wins over the request model and the tier", async () => {
    const { client, calls } = fakeClient({ outputs: [{ word: "a", level: "A1" }] });
    await createAnthropicProvider({ apiKey, client, model: "claude-opus-5-5" }).complete({
      ...request,
      model: "other",
      tier: "fast",
    });
    expect(calls[0]?.model).toBe("claude-opus-5-5");

    const tiered = fakeClient({ outputs: [{ word: "a", level: "A1" }] });
    await createAnthropicProvider({ apiKey, client: tiered.client }).complete({
      ...request,
      tier: "fast",
    });
    expect(tiered.calls[0]?.model).toBe("claude-haiku-5-5");
    expect(tiered.calls[0]?.output_config?.format.type).toBe("json_schema");
  });

  test("repairs invalid output once, with the bad text in the repair turn", async () => {
    const { client, calls } = fakeClient({
      outputs: ['{"word": "cat", "level": "C2"}', { word: "cat", level: "A2" }],
    });
    const result = await createAnthropicProvider({ apiKey, client }).complete(request);

    expect(result.data).toEqual({ word: "cat", level: "A2" });
    expect(result.usage).toEqual({ input: 200, output: 40 });
    const repairTurn = calls[1]?.messages ?? [];
    expect(repairTurn.at(-2)).toEqual({
      role: "assistant",
      content: '{"word": "cat", "level": "C2"}',
    });
    expect(repairTurn.at(-1)?.content).toContain("Your previous output failed validation");
  });

  test("text that is not JSON (a refusal, a truncated answer) earns the repair turn", async () => {
    const { client } = fakeClient({ outputs: ['{"word": "ca', { word: "cat", level: "A1" }] });
    const result = await createAnthropicProvider({ apiKey, client }).complete(request);
    expect(result.data).toEqual({ word: "cat", level: "A1" });
  });

  test("throws LlmOutputError when the repair fails too", async () => {
    const { client, calls } = fakeClient({ outputs: [{}, { word: 1 }] });
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

  test("listModels rethrows 401/403 as a scrubbed LlmProviderError instead of falling back", async () => {
    for (const status of [401, 403]) {
      const rejected = fakeClient({
        models: Object.assign(new Error(`${status} invalid x-api-key ${apiKey}`), { status }),
      });
      const error = await createAnthropicProvider({ apiKey, client: rejected.client })
        .listModels?.()
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LlmProviderError);
      expect((error as LlmProviderError).status).toBe(status);
      expect((error as Error).message).not.toContain(apiKey);
    }
  });
});

/** Every object node of a JSON Schema, depth first. */
function objectNodes(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(objectNodes);
  if (typeof node !== "object" || node === null) return [];
  const record = node as Record<string, unknown>;
  const children = Object.values(record).flatMap(objectNodes);
  return record.type === "object" ? [record, ...children] : children;
}

const UNSUPPORTED_KEYWORDS = [
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "maxItems",
];

function keywordsIn(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(keywordsIn);
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) => [
    // `properties` maps field names, not keywords.
    ...(key === "properties" ? [] : [key]),
    ...(key === "properties"
      ? Object.values(value as object).flatMap(keywordsIn)
      : keywordsIn(value)),
  ]);
}

describe("anthropicSchema", () => {
  test("strips $schema, closes objects and moves bounds into descriptions", () => {
    const converted = anthropicSchema(
      z.object({ score: z.number().min(0).max(1), tags: z.array(z.string().min(1)).min(1) }),
    );
    expect(converted).not.toHaveProperty("$schema");
    expect(converted.additionalProperties).toBe(false);
    expect(converted.required).toEqual(["score", "tags"]);
    expect(keywordsIn(converted)).toContain("items");
    expect(keywordsIn(converted)).not.toContain("minimum");
    expect(keywordsIn(converted)).not.toContain("minLength");
    expect(JSON.stringify(converted)).toContain("minimum: 0");
  });

  test("keeps enum, const, anyOf and supported formats; nullable types become anyOf", () => {
    const converted = anthropicSchema(
      z.object({
        level: z.enum(["A1", "A2"]),
        kind: z.literal("quiz"),
        note: z.string().nullable(),
        when: z.iso.datetime(),
        either: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]),
      }),
    ) as { properties: Record<string, Record<string, unknown>> };
    const { level, kind, note, when, either } = converted.properties;
    expect(level?.enum).toEqual(["A1", "A2"]);
    expect(kind?.const).toBe("quiz");
    expect(note?.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
    expect(when?.format).toBe("date-time");
    expect(either?.anyOf).toHaveLength(2);
    expect(objectNodes(either)).toHaveLength(2);
    for (const node of objectNodes(either)) expect(node.additionalProperties).toBe(false);
  });

  test.each(Object.entries(outputSchemas))(
    "the %s skill output converts cleanly",
    (_name, output) => {
      const converted = anthropicSchema(output);
      expect(converted.type).toBe("object");
      for (const node of objectNodes(converted)) expect(node.additionalProperties).toBe(false);
      const keywords = keywordsIn(converted);
      for (const keyword of UNSUPPORTED_KEYWORDS) expect(keywords).not.toContain(keyword);
      expect(JSON.stringify(converted)).not.toMatch(/"type":\[/);
      // Enumerations reach the model as constraints, not as prose.
      if (JSON.stringify(toJsonSchema(output)).includes('"enum"'))
        expect(keywords).toContain("enum");
    },
  );
});
