import type { Env } from "../../config/env";
import { PROVIDER_UNAVAILABLE_KEYS, ProviderUnavailableError } from "../errors";
import type { LlmProvider } from "../types";
import type { ProviderFactories } from "./factories";

export type ServerEnv = Pick<
  Env,
  | "SERVER_LLM_PROVIDER"
  | "SERVER_ANTHROPIC_API_KEY"
  | "SERVER_OPENAI_API_KEY"
  | "SERVER_OPENAI_BASE_URL"
  | "SERVER_DEFAULT_MODEL"
  | "CLAUDE_BIN"
>;

function unavailable(message: string): ProviderUnavailableError {
  return new ProviderUnavailableError("server", PROVIDER_UNAVAILABLE_KEYS.server, message);
}

/**
 * The owner's provider from env (`SERVER_LLM_PROVIDER`), presented as kind `server`.
 * `SERVER_DEFAULT_MODEL`, when set, plays the part of the user's chosen model.
 */
export function createServerProvider(env: ServerEnv, factories: ProviderFactories): LlmProvider {
  const model = env.SERVER_DEFAULT_MODEL;
  let delegate: LlmProvider;

  switch (env.SERVER_LLM_PROVIDER) {
    case "anthropic":
      if (!env.SERVER_ANTHROPIC_API_KEY) throw unavailable("SERVER_ANTHROPIC_API_KEY is not set");
      delegate = factories.anthropic({ apiKey: env.SERVER_ANTHROPIC_API_KEY, model });
      break;
    case "openai":
      if (!env.SERVER_OPENAI_API_KEY) throw unavailable("SERVER_OPENAI_API_KEY is not set");
      delegate = factories.openai({
        apiKey: env.SERVER_OPENAI_API_KEY,
        baseUrl: env.SERVER_OPENAI_BASE_URL,
        model,
      });
      break;
    case "claude-code":
      delegate = factories.claudeCode({ command: [env.CLAUDE_BIN], model });
      break;
    default:
      throw unavailable("SERVER_LLM_PROVIDER is not set");
  }

  return {
    kind: "server",
    complete: (req) => delegate.complete(req),
    listModels: delegate.listModels?.bind(delegate),
  };
}
