import type { ModelTier } from "./types";

export type ModelBackend = "anthropic" | "openai" | "claude-code";

/** Default model per backend and tier, used when neither the user nor the caller names one. */
export const DEFAULT_MODELS: Record<ModelBackend, Record<ModelTier, string>> = {
  anthropic: { smart: "claude-sonnet-5-5", fast: "claude-haiku-5-5" },
  openai: { smart: "gpt-6-astra", fast: "gpt-6-luna" },
  "claude-code": { smart: "sonnet", fast: "haiku" },
};

/** What `listModels` returns when the live listing fails. */
export const CURATED_MODELS: Record<ModelBackend, string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  openai: ["gpt-6-astra", "gpt-6-luna"],
  "claude-code": ["opus", "sonnet", "haiku"],
};

/** What a model accepts, so a provider shapes the request up front instead of retrying on a 400. */
export type ModelCapabilities = {
  /**
   * `json_schema`: the backend's native structured output (Anthropic `output_config.format`,
   * OpenAI `response_format`). `forced_tool`: a forced call of one tool whose input is the answer.
   */
  structuredOutput: "json_schema" | "forced_tool";
  /** Whether `temperature` / `top_p` / `top_k` may be sent. Otherwise they are dropped silently. */
  sampling: boolean;
};

type CapabilityRule = { match: RegExp; capabilities: ModelCapabilities };

/**
 * First match wins; the last rule of each backend matches every model. Router ids such as
 * `openai/gpt-6-luna` are matched on their last path segment.
 */
const CAPABILITY_RULES: Record<ModelBackend, CapabilityRule[]> = {
  // The SDK pins API version 2026-10-21, which removes sampling parameters on every model.
  anthropic: [
    // Models that predate structured outputs.
    {
      match: /^claude-(3|opus-4-0|sonnet-4-0|opus-4-\d{8}|sonnet-4-\d{8})/,
      capabilities: { structuredOutput: "forced_tool", sampling: false },
    },
    { match: /./, capabilities: { structuredOutput: "json_schema", sampling: false } },
  ],
  openai: [
    // Reasoning families reject a non-default temperature.
    {
      match: /^(o\d|gpt-5|gpt-6)/,
      capabilities: { structuredOutput: "json_schema", sampling: false },
    },
    { match: /./, capabilities: { structuredOutput: "json_schema", sampling: true } },
  ],
  // `claude -p` has no sampling flag; `--json-schema` carries the schema.
  "claude-code": [
    { match: /./, capabilities: { structuredOutput: "json_schema", sampling: false } },
  ],
};

export function modelCapabilities(backend: ModelBackend, model: string): ModelCapabilities {
  const id = model.slice(model.lastIndexOf("/") + 1).toLowerCase();
  const rules = CAPABILITY_RULES[backend];
  const rule = rules.find((candidate) => candidate.match.test(id)) ?? rules[rules.length - 1];
  if (!rule) throw new Error(`no capability rules for ${backend}`);
  return rule.capabilities;
}

/** The sampling fields to spread into a request: empty when unset or not accepted by the model. */
export function samplingParams(
  capabilities: ModelCapabilities,
  temperature: number | undefined,
): { temperature?: number } {
  return capabilities.sampling && temperature !== undefined ? { temperature } : {};
}

/**
 * Picks the model for one call. The user's chosen model always wins; then the caller's explicit
 * model; then the backend default for the tier (`smart` when none is given).
 */
export function pickModel(
  backend: ModelBackend,
  choice: { userModel?: string | null; requestModel?: string; tier?: ModelTier },
): string {
  return choice.userModel || choice.requestModel || DEFAULT_MODELS[backend][choice.tier ?? "smart"];
}
