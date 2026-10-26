import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { LlmOutputError, LlmProviderError } from "../../src/llm/errors";
import { CURATED_MODELS } from "../../src/llm/models";
import { createOpenAiProvider, type OpenAiClient } from "../../src/llm/providers/openai";

const apiKey = "sk-proj-secretsecretsecret-c3d4";
const schema = z.object({ correction: z.string(), category: z.enum(["grammar", "spelling"]) });
const request = {
  system: "Correct the sentence.",
  messages: [{ role: "user" as const, content: "I goes home" }],
  schema,
};
const valid = JSON.stringify({ correction: "I go home", category: "grammar" });

type CreateParams = Parameters<OpenAiClient["chat"]["completions"]["create"]>[0];

function apiError(status: number, message: string): Error {
  return Object.assign(new Error(`${status} ${message}`), { status });
}

/** Each reply is either the content to return or an error to throw. */
function fakeClient(replies: (string | Error)[], models: string[] | Error = []) {
  const calls: CreateParams[] = [];
  const client: OpenAiClient = {
    chat: {
      completions: {
        create: async (params) => {
          calls.push(params);
          const reply = replies[calls.length - 1];
          if (reply instanceof Error) throw reply;
          return {
            choices: [{ message: { content: reply ?? null } }],
            usage: { prompt_tokens: 50, completion_tokens: 7 },
          };
        },
      },
    },
    models: {
      list: () =>
        (async function* () {
          if (models instanceof Error) throw models;
          for (const id of models) yield { id };
        })(),
    },
  };
  return { client, calls };
}

describe("openai provider (fake client)", () => {
  test("uses json_schema with the system prompt first and returns parsed data", async () => {
    const { client, calls } = fakeClient([valid]);
    const provider = createOpenAiProvider({ apiKey, client });
    const result = await provider.complete(request);

    expect(provider.kind).toBe("openai");
    expect(result).toEqual({
      data: { correction: "I go home", category: "grammar" },
      usage: { input: 50, output: 7 },
    });
    const params = calls[0];
    expect(params?.model).toBe("gpt-6-astra");
    expect(params?.messages[0]).toEqual({ role: "system", content: "Correct the sentence." });
    expect(params?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "response", schema: { type: "object" } },
    });
    expect(params?.max_completion_tokens).toBe(2048);
    expect(params?.max_tokens).toBeUndefined();
  });

  test("a custom base URL sends max_tokens, which routers understand", async () => {
    const { client, calls } = fakeClient([valid]);
    await createOpenAiProvider({
      apiKey,
      client,
      baseUrl: "https://openrouter.ai/api/v1",
    }).complete({ ...request, maxTokens: 99 });
    expect(calls[0]?.max_tokens).toBe(99);
    expect(calls[0]?.max_completion_tokens).toBeUndefined();
  });

  test("passes temperature only when the request sets it", async () => {
    const { client, calls } = fakeClient([valid, valid]);
    const provider = createOpenAiProvider({ apiKey, client });
    await provider.complete({ ...request, temperature: 0.3 });
    await provider.complete(request);
    expect(calls[0]?.temperature).toBe(0.3);
    expect(calls[1]).not.toHaveProperty("temperature");
  });

  test("falls back to json_object, with the schema in the prompt, and remembers it", async () => {
    const { client, calls } = fakeClient([
      apiError(400, "Invalid parameter: 'response_format' of type 'json_schema' is not supported"),
      valid,
      valid,
    ]);
    const provider = createOpenAiProvider({ apiKey, client });

    expect((await provider.complete(request)).data.category).toBe("grammar");
    expect(calls[1]?.response_format).toEqual({ type: "json_object" });
    expect(calls[1]?.messages[0]?.content).toContain("JSON Schema");

    await provider.complete(request);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.response_format).toEqual({ type: "json_object" });
  });

  test("an unrelated 400 is not mistaken for missing json_schema support", async () => {
    const { client, calls } = fakeClient([apiError(400, "model not found")]);
    await expect(createOpenAiProvider({ apiKey, client }).complete(request)).rejects.toThrow(
      LlmProviderError,
    );
    expect(calls).toHaveLength(1);
  });

  test("repairs once, then gives up with LlmOutputError", async () => {
    const repaired = fakeClient(['{"correction":"x"}', valid]);
    const result = await createOpenAiProvider({ apiKey, client: repaired.client }).complete(
      request,
    );
    expect(result.data.correction).toBe("I go home");
    expect(repaired.calls[1]?.messages.at(-1)?.content).toContain("failed validation");

    const broken = fakeClient(["{", "{"]);
    await expect(
      createOpenAiProvider({ apiKey, client: broken.client }).complete(request),
    ).rejects.toThrow(LlmOutputError);
  });

  test("wraps SDK errors without leaking the key", async () => {
    const { client } = fakeClient([apiError(401, `Incorrect API key provided: ${apiKey}`)]);
    const error = await createOpenAiProvider({ apiKey, client })
      .complete(request)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).status).toBe(401);
    expect((error as Error).message).not.toContain(apiKey);
  });

  test("listModels sorts the live list and falls back to the curated list on error", async () => {
    const live = fakeClient([], ["gpt-6-luna", "gpt-6-astra"]);
    expect(await createOpenAiProvider({ apiKey, client: live.client }).listModels?.()).toEqual([
      "gpt-6-astra",
      "gpt-6-luna",
    ]);
    const failing = fakeClient([], apiError(500, "down"));
    expect(await createOpenAiProvider({ apiKey, client: failing.client }).listModels?.()).toEqual(
      CURATED_MODELS.openai,
    );
  });
});

/** The real SDK against a local OpenAI-compatible router: proves base URL handling end to end. */
describe("openai provider (real SDK, custom base URL)", () => {
  const seen: { path: string; auth: string | null; body?: Record<string, unknown> }[] = [];
  let server: ReturnType<typeof Bun.serve>;
  let modelsFail = false;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body =
          req.method === "POST" ? ((await req.json()) as Record<string, unknown>) : undefined;
        seen.push({ path: url.pathname, auth: req.headers.get("authorization"), body });

        if (url.pathname === "/router/v1/models") {
          // 403, not 5xx: the SDK retries 5xx with backoff, which would only slow the test down.
          if (modelsFail) return Response.json({ error: { message: "nope" } }, { status: 403 });
          return Response.json({
            object: "list",
            data: [
              { id: "vendor/model-b", object: "model", created: 0, owned_by: "x" },
              { id: "vendor/model-a", object: "model", created: 0, owned_by: "x" },
            ],
          });
        }
        if (url.pathname === "/router/v1/chat/completions") {
          return Response.json({
            id: "c1",
            object: "chat.completion",
            created: 0,
            model: String(body?.model),
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: valid },
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
  });
  afterAll(() => server.stop(true));

  const baseUrl = () => `http://localhost:${server.port}/router/v1`;

  test("completes through the router with the user's model and key", async () => {
    const provider = createOpenAiProvider({ apiKey, baseUrl: baseUrl(), model: "vendor/model-a" });
    const result = await provider.complete(request);

    expect(result).toEqual({
      data: { correction: "I go home", category: "grammar" },
      usage: { input: 3, output: 4 },
    });
    const call = seen.find((entry) => entry.path === "/router/v1/chat/completions");
    expect(call?.auth).toBe(`Bearer ${apiKey}`);
    expect(call?.body?.model).toBe("vendor/model-a");
    expect(call?.body?.max_tokens).toBe(2048);
  });

  test("listModels uses GET /models on the router, with the curated fallback on error", async () => {
    const provider = createOpenAiProvider({ apiKey, baseUrl: baseUrl() });
    expect(await provider.listModels?.()).toEqual(["vendor/model-a", "vendor/model-b"]);

    modelsFail = true;
    const fallback = createOpenAiProvider({ apiKey, baseUrl: baseUrl() });
    expect(await fallback.listModels?.()).toEqual(CURATED_MODELS.openai);
  });
});
