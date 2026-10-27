import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { isAuthError, toProviderError } from "../errors";
import { CURATED_MODELS, modelCapabilities, pickModel, samplingParams } from "../models";
import { completeWithRepair, toJsonSchema } from "../structured";
import type { ChatMessage, CompletionRequest, LlmProvider } from "../types";

const TOOL_NAME = "respond";
// Current models think adaptively by default, and thinking shares this budget with the answer.
// Only the tokens actually produced are billed.
const DEFAULT_MAX_TOKENS = 16_000;

type ContentBlock = { type: string; text?: string; name?: string; input?: unknown };

type CreateParams = {
  model: string;
  max_tokens: number;
  temperature?: number;
  system: string;
  messages: ChatMessage[];
  output_config?: { format: { type: "json_schema"; schema: Record<string, unknown> } };
  tools?: { name: string; description: string; input_schema: { type: "object" } }[];
  tool_choice?: { type: "tool"; name: string };
};

/** The slice of the Anthropic SDK this provider uses; tests pass a fake. */
export type AnthropicClient = {
  messages: {
    create(params: CreateParams): Promise<{
      content: ContentBlock[];
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
  models: { list(): AsyncIterable<{ id: string }> };
};

export type AnthropicProviderOptions = {
  apiKey: string;
  /** The user's chosen model; wins over the request's model and tier. */
  model?: string | null;
  /**
   * Sent as `anthropic-workspace-id` on every request. Keys not scoped to a workspace
   * (`sk-ant-usr-…`) are refused without it.
   */
  workspaceId?: string | null;
  client?: AnthropicClient;
  /** Replaces the SDK's HTTP transport; tests pass a fake to see the real requests. */
  fetch?: ClientOptions["fetch"];
};

export const WORKSPACE_HEADER = "anthropic-workspace-id";

/** Keywords structured outputs accept, copied as they are. Subschemas are handled separately. */
const KEPT_KEYWORDS = new Set(["type", "enum", "const", "required", "description", "title"]);
const STRING_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

function normalise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalise);
  if (typeof node !== "object" || node === null) return node;

  const out: Record<string, unknown> = {};
  const moved: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (KEPT_KEYWORDS.has(key) || key === "$ref") out[key] = value;
    else if (key === "properties" || key === "$defs") {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, sub]) => [
          name,
          normalise(sub),
        ]),
      );
    } else if (key === "items" || key === "anyOf" || key === "allOf") out[key] = normalise(value);
    else if (key === "oneOf") out.anyOf = normalise(value);
    else if (key === "format" && STRING_FORMATS.has(String(value))) out[key] = value;
    else if (key === "minItems" && (value === 0 || value === 1)) out[key] = value;
    else if (key !== "$schema" && key !== "additionalProperties") {
      moved.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  if (out.type === "object") out.additionalProperties = false;
  if (moved.length > 0) {
    const constraints = `{${moved.join(", ")}}`;
    out.description = out.description ? `${out.description}\n\n${constraints}` : constraints;
  }
  return Array.isArray(out.type) ? typeUnion(out, out.type) : out;
}

/** `type: ["string", "null"]` (how zod writes a nullable primitive) as the `anyOf` it means. */
function typeUnion(node: Record<string, unknown>, types: unknown[]): Record<string, unknown> {
  const { type: _types, description, title, ...rest } = node;
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    anyOf: types.map((type) =>
      type === "null"
        ? { type }
        : { type, ...rest, ...(type === "object" ? { additionalProperties: false } : {}) },
    ),
  };
}

/**
 * The zod schema as structured outputs accept it: no `$schema`, `additionalProperties: false` on
 * every object, `oneOf` as `anyOf`, and every other unsupported keyword (bounds, lengths,
 * patterns, defaults) moved into the description as a hint. zod still enforces those on the
 * answer, and a violation earns the repair turn.
 */
export function anthropicSchema(schema: ZodType): Record<string, unknown> {
  return normalise(toJsonSchema(schema)) as Record<string, unknown>;
}

/** How one attempt asks for structured output, and where in the response the answer is. */
function structuredOutput(
  mode: "json_schema" | "forced_tool",
  schema: Record<string, unknown>,
): {
  params: Pick<CreateParams, "output_config" | "tools" | "tool_choice">;
  read(content: ContentBlock[]): string;
} {
  if (mode === "json_schema") {
    return {
      params: { output_config: { format: { type: "json_schema", schema } } },
      read: (content) =>
        content
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join(""),
    };
  }
  return {
    params: {
      tools: [
        {
          name: TOOL_NAME,
          description: "Return the answer. Its input is the whole response.",
          input_schema: { ...schema, type: "object" },
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
    },
    read: (content) => {
      const call = content.find((block) => block.type === "tool_use" && block.name === TOOL_NAME);
      // A missing tool call becomes "null", which fails the schema and earns a repair turn.
      return JSON.stringify(call?.input ?? null);
    },
  };
}

/**
 * Anthropic Messages API. Structured output is `output_config.format` with the zod-derived JSON
 * Schema; models that predate it get a forced call of a single tool instead. Which one, and
 * whether sampling parameters are sent, comes from the model's capability entry.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): LlmProvider {
  const { apiKey, workspaceId } = options;
  const client: AnthropicClient =
    options.client ??
    new Anthropic({
      apiKey,
      fetch: options.fetch,
      defaultHeaders: workspaceId ? { [WORKSPACE_HEADER]: workspaceId } : undefined,
    });

  return {
    kind: "anthropic",

    async complete<T>(req: CompletionRequest<T>) {
      const model = pickModel("anthropic", {
        userModel: options.model,
        requestModel: req.model,
        tier: req.tier,
      });
      const capabilities = modelCapabilities("anthropic", model);
      const output = structuredOutput(capabilities.structuredOutput, anthropicSchema(req.schema));

      return completeWithRepair("anthropic", req.messages, req.schema, async (messages) => {
        let response: Awaited<ReturnType<AnthropicClient["messages"]["create"]>>;
        try {
          response = await client.messages.create({
            model,
            max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...samplingParams(capabilities, req.temperature),
            system: req.system,
            messages,
            ...output.params,
          });
        } catch (error) {
          throw toProviderError("anthropic", error, [apiKey]);
        }
        return {
          text: output.read(response.content),
          usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
        };
      });
    },

    async listModels() {
      try {
        const ids: string[] = [];
        for await (const model of client.models.list()) ids.push(model.id);
        return ids.length > 0 ? ids : CURATED_MODELS.anthropic;
      } catch (error) {
        // A rejected key must surface (settings validates keys this way); anything else falls back.
        if (isAuthError(error)) throw toProviderError("anthropic", error, [apiKey]);
        return CURATED_MODELS.anthropic;
      }
    },
  };
}
