import type { Db } from "../db/client";
import { decryptProviderKey, getActiveProviderConfig } from "../db/repositories/providers";
import type { ProviderConfig } from "../db/schema";
import { PROVIDER_UNAVAILABLE_KEYS, ProviderUnavailableError } from "./errors";
import { defaultFactories, type ProviderFactories } from "./providers/factories";
import { createServerProvider, type ServerEnv } from "./providers/server";
import type { LlmProvider } from "./types";

export type ResolverDeps = {
  db: Db;
  env: ServerEnv;
  masterKey: Buffer;
  factories?: ProviderFactories;
};

function requireKey(config: ProviderConfig, masterKey: Buffer): string {
  const apiKey = decryptProviderKey(config, masterKey);
  if (!apiKey) throw new Error(`provider config ${config.id} (${config.kind}) has no API key`);
  return apiKey;
}

/** Builds the provider a config describes; no config means the server's provider. */
export function providerFromConfig(
  config: ProviderConfig | undefined,
  deps: Omit<ResolverDeps, "db">,
): LlmProvider {
  const factories = deps.factories ?? defaultFactories;

  switch (config?.kind ?? "server") {
    case "server":
      return createServerProvider(deps.env, factories);
    case "anthropic":
      if (!config) break;
      return factories.anthropic({
        apiKey: requireKey(config, deps.masterKey),
        model: config.model,
      });
    case "openai":
      if (!config) break;
      return factories.openai({
        apiKey: requireKey(config, deps.masterKey),
        baseUrl: config.baseUrl,
        model: config.model,
      });
    case "claude-code":
      return factories.claudeCode({ command: [deps.env.CLAUDE_BIN], model: config?.model });
    case "runner":
      throw new ProviderUnavailableError(
        "runner",
        PROVIDER_UNAVAILABLE_KEYS.runner,
        "the runner provider is not available yet",
      );
  }
  throw new Error("unreachable provider kind");
}

/** The provider for a user's next request: their active config, else `server`. */
export async function resolveProvider(deps: ResolverDeps, userId: number): Promise<LlmProvider> {
  return providerFromConfig(await getActiveProviderConfig(deps.db, userId), deps);
}
