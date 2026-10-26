import type { Db } from "../db/client";
import { decryptProviderKey, listProviderConfigs } from "../db/repositories/providers";
import type { ServerEnv } from "../llm/providers/server";

/** Where audio requests go: an OpenAI-compatible endpoint and the key for it. */
export interface AudioCredentials {
  apiKey: string;
  /** Unset means api.openai.com. */
  baseUrl?: string | null;
}

export interface CredentialDeps {
  db: Db;
  env: Pick<ServerEnv, "SERVER_OPENAI_API_KEY" | "SERVER_OPENAI_BASE_URL">;
  masterKey: Buffer;
}

/**
 * The key voice features use: the user's own OpenAI-compatible key (the active config first, then
 * any saved one), else `SERVER_OPENAI_API_KEY`. Undefined when there is neither — the caller
 * explains that voice needs a key instead of failing.
 */
export async function resolveAudioCredentials(
  deps: CredentialDeps,
  userId: number,
): Promise<AudioCredentials | undefined> {
  const configs = await listProviderConfigs(deps.db, userId);
  const own = configs
    .filter((config) => config.kind === "openai" && config.encryptedApiKey)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive))[0];
  if (own) {
    const apiKey = decryptProviderKey(own, deps.masterKey);
    if (apiKey) return { apiKey, baseUrl: own.baseUrl };
  }
  const serverKey = deps.env.SERVER_OPENAI_API_KEY;
  if (serverKey) return { apiKey: serverKey, baseUrl: deps.env.SERVER_OPENAI_BASE_URL };
  return undefined;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** `<base>/<path>` without doubled or missing slashes. */
export function audioUrl(credentials: AudioCredentials, path: string): string {
  const base = (credentials.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}/${path}`;
}
