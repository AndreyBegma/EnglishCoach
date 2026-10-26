import type { ZodType } from "zod";
import type { ProviderKind } from "../db/schema/enums";

export type { ProviderKind };

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** `fast` for cheap high-volume turns, `smart` for the rest. A skill picks one via its `model_hint`. */
export type ModelTier = "fast" | "smart";

export type CompletionRequest<T> = {
  system: string;
  messages: ChatMessage[];
  /** The output contract. The provider returns only data that passed it. */
  schema: ZodType<T>;
  /** Used only when the user has not chosen a model. */
  model?: string;
  /** Used only when neither the user nor `model` names one. Defaults to `smart`. */
  tier?: ModelTier;
  maxTokens?: number;
};

export type Usage = { input: number; output: number };

export type CompletionResult<T> = { data: T; usage?: Usage };

export interface LlmProvider {
  kind: ProviderKind;
  complete<T>(req: CompletionRequest<T>): Promise<CompletionResult<T>>;
  listModels?(): Promise<string[]>;
}
