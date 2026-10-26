import {
  type LlmProvider,
  LlmProviderError,
  type ProviderFactories,
  type ProviderKind,
} from "../../src/llm";

export interface BuiltProvider {
  kind: ProviderKind;
  apiKey?: string;
  baseUrl?: string | null;
  model?: string | null;
}

/**
 * Stand-in for the SDK-backed providers. A key outside `validKeys` fails `listModels` and
 * `complete` with HTTP 401, as the real providers do for a rejected key.
 */
export class FakeLlm {
  readonly validKeys = new Set<string>(["server-key"]);
  models = ["model-a", "model-b"];
  /** What `complete` does next: answer, or throw this error. */
  completeError?: Error;
  /** Called on every `listModels`, before it answers. */
  onListModels?: () => void;
  readonly built: BuiltProvider[] = [];

  readonly factories: ProviderFactories = {
    anthropic: (options) => this.provider({ kind: "anthropic", ...options }),
    openai: (options) => this.provider({ kind: "openai", ...options }),
    claudeCode: (options) => this.provider({ kind: "claude-code", model: options.model }),
  };

  private provider(built: BuiltProvider): LlmProvider {
    this.built.push(built);
    const check = () => {
      if (built.apiKey !== undefined && !this.validKeys.has(built.apiKey)) {
        throw new LlmProviderError(
          built.kind,
          `${built.kind} request failed: 401 invalid key`,
          401,
        );
      }
    };
    return {
      kind: built.kind,
      complete: async (req) => {
        check();
        if (this.completeError) throw this.completeError;
        return { data: req.schema.parse({ ok: true }) };
      },
      listModels: async () => {
        this.onListModels?.();
        check();
        return [...this.models];
      },
    };
  }
}
