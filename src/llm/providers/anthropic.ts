import Anthropic from "@anthropic-ai/sdk";
import { toProviderError } from "../errors";
import { CURATED_MODELS, pickModel } from "../models";
import { completeWithRepair, toJsonSchema } from "../structured";
import type { ChatMessage, CompletionRequest, LlmProvider } from "../types";

const TOOL_NAME = "respond";
const DEFAULT_MAX_TOKENS = 2048;

type ToolUseBlock = { type: string; name?: string; input?: unknown };

/** The slice of the Anthropic SDK this provider uses; tests pass a fake. */
export type AnthropicClient = {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: ChatMessage[];
      tools: { name: string; description: string; input_schema: { type: "object" } }[];
      tool_choice: { type: "tool"; name: string };
    }): Promise<{
      content: ToolUseBlock[];
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
  models: { list(): AsyncIterable<{ id: string }> };
};

export type AnthropicProviderOptions = {
  apiKey: string;
  /** The user's chosen model; wins over the request's model and tier. */
  model?: string | null;
  client?: AnthropicClient;
};

/**
 * Anthropic Messages API. Structured output is a forced call of a single tool whose input schema
 * is the zod schema; the tool input is the answer.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): LlmProvider {
  const { apiKey } = options;
  const client: AnthropicClient = options.client ?? new Anthropic({ apiKey });

  return {
    kind: "anthropic",

    async complete<T>(req: CompletionRequest<T>) {
      const model = pickModel("anthropic", {
        userModel: options.model,
        requestModel: req.model,
        tier: req.tier,
      });
      const inputSchema = { ...toJsonSchema(req.schema), type: "object" as const };

      return completeWithRepair("anthropic", req.messages, req.schema, async (messages) => {
        let response: Awaited<ReturnType<AnthropicClient["messages"]["create"]>>;
        try {
          response = await client.messages.create({
            model,
            max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
            system: req.system,
            messages,
            tools: [
              {
                name: TOOL_NAME,
                description: "Return the answer. Its input is the whole response.",
                input_schema: inputSchema,
              },
            ],
            tool_choice: { type: "tool", name: TOOL_NAME },
          });
        } catch (error) {
          throw toProviderError("anthropic", error, [apiKey]);
        }
        const call = response.content.find(
          (block) => block.type === "tool_use" && block.name === TOOL_NAME,
        );
        return {
          // A missing tool call becomes "null", which fails the schema and earns a repair turn.
          text: JSON.stringify(call?.input ?? null),
          usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
        };
      });
    },

    async listModels() {
      try {
        const ids: string[] = [];
        for await (const model of client.models.list()) ids.push(model.id);
        return ids.length > 0 ? ids : CURATED_MODELS.anthropic;
      } catch {
        return CURATED_MODELS.anthropic;
      }
    },
  };
}
