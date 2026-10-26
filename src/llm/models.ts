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
