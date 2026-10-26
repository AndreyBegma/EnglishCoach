import OpenAI from "openai";
import { isAuthError, toProviderError } from "../errors";
import { CURATED_MODELS, pickModel } from "../models";
import { completeWithRepair, toJsonSchema } from "../structured";
import type { CompletionRequest, LlmProvider } from "../types";

const DEFAULT_MAX_TOKENS = 2048;

type ResponseFormat =
  | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown> } }
  | { type: "json_object" };

/** The slice of the OpenAI SDK this provider uses; tests pass a fake. */
export type OpenAiClient = {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: { role: "system" | "user" | "assistant"; content: string }[];
        response_format: ResponseFormat;
        max_tokens?: number;
        max_completion_tokens?: number;
        temperature?: number;
      }): Promise<{
        choices: { message: { content: string | null } }[];
        usage?: { prompt_tokens: number; completion_tokens: number } | null;
      }>;
    };
  };
  models: { list(): AsyncIterable<{ id: string }> };
};

export type OpenAiProviderOptions = {
  apiKey: string;
  /** OpenRouter or any OpenAI-compatible router. Unset means api.openai.com. */
  baseUrl?: string | null;
  /** The user's chosen model; wins over the request's model and tier. */
  model?: string | null;
  client?: OpenAiClient;
};

/** A 4xx naming the response format: the endpoint does not support `json_schema`. */
function rejectsJsonSchema(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = "status" in error ? Number(error.status) : 0;
  return (status === 400 || status === 422) && /response_format|json_schema/i.test(error.message);
}

/**
 * OpenAI Chat Completions, or any compatible router via `baseUrl`. Structured output uses
 * `response_format: json_schema`; an endpoint that rejects it is switched to `json_object` with
 * the schema in the system prompt, for the life of this provider.
 */
export function createOpenAiProvider(options: OpenAiProviderOptions): LlmProvider {
  const { apiKey } = options;
  const baseURL = options.baseUrl ?? undefined;
  const client: OpenAiClient = options.client ?? new OpenAI({ apiKey, baseURL });
  let jsonSchemaSupported = true;

  return {
    kind: "openai",

    async complete<T>(req: CompletionRequest<T>) {
      const model = pickModel("openai", {
        userModel: options.model,
        requestModel: req.model,
        tier: req.tier,
      });
      const schema = toJsonSchema(req.schema);
      const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
      // api.openai.com wants max_completion_tokens; routers broadly still only read max_tokens.
      const limit = baseURL ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens };
      const sampling = req.temperature === undefined ? {} : { temperature: req.temperature };

      return completeWithRepair("openai", req.messages, req.schema, async (messages) => {
        const send = (format: "json_schema" | "json_object") =>
          client.chat.completions.create({
            model,
            ...limit,
            ...sampling,
            messages: [
              {
                role: "system",
                content:
                  format === "json_schema"
                    ? req.system
                    : `${req.system}\n\nRespond with a single JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}`,
              },
              ...messages,
            ],
            response_format:
              format === "json_schema"
                ? { type: "json_schema", json_schema: { name: "response", schema } }
                : { type: "json_object" },
          });

        let response: Awaited<ReturnType<typeof send>>;
        try {
          if (jsonSchemaSupported) {
            try {
              response = await send("json_schema");
            } catch (error) {
              if (!rejectsJsonSchema(error)) throw error;
              response = await send("json_object");
              jsonSchemaSupported = false;
            }
          } else {
            response = await send("json_object");
          }
        } catch (error) {
          throw toProviderError("openai", error, [apiKey]);
        }

        return {
          text: response.choices[0]?.message.content ?? "",
          usage: response.usage
            ? { input: response.usage.prompt_tokens, output: response.usage.completion_tokens }
            : undefined,
        };
      });
    },

    async listModels() {
      try {
        const ids: string[] = [];
        for await (const model of client.models.list()) ids.push(model.id);
        return ids.length > 0 ? ids.sort() : CURATED_MODELS.openai;
      } catch (error) {
        // A rejected key must surface (settings validates keys this way); anything else falls back.
        if (isAuthError(error)) throw toProviderError("openai", error, [apiKey]);
        return CURATED_MODELS.openai;
      }
    },
  };
}
