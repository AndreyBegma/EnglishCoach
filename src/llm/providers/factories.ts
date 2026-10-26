import type { LlmProvider } from "../types";
import { type AnthropicProviderOptions, createAnthropicProvider } from "./anthropic";
import { type ClaudeCodeProviderOptions, createClaudeCodeProvider } from "./claude-code";
import { createOpenAiProvider, type OpenAiProviderOptions } from "./openai";

/** How the resolver builds concrete providers; tests replace them. */
export type ProviderFactories = {
  anthropic(options: AnthropicProviderOptions): LlmProvider;
  openai(options: OpenAiProviderOptions): LlmProvider;
  claudeCode(options: ClaudeCodeProviderOptions): LlmProvider;
};

export const defaultFactories: ProviderFactories = {
  anthropic: createAnthropicProvider,
  openai: createOpenAiProvider,
  claudeCode: createClaudeCodeProvider,
};
