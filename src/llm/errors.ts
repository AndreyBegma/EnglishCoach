import type { ProviderKind } from "./types";

/** i18n keys (locales/*.ftl) the bot shows when a provider cannot be used. */
export const PROVIDER_UNAVAILABLE_KEYS = {
  runner: "provider-unavailable-runner",
  server: "provider-unavailable-server",
} as const;

export type ProviderUnavailableKey =
  (typeof PROVIDER_UNAVAILABLE_KEYS)[keyof typeof PROVIDER_UNAVAILABLE_KEYS];

/** The user's provider cannot serve requests at all. `i18nKey` is what the bot tells the user. */
export class ProviderUnavailableError extends Error {
  override name = "ProviderUnavailableError";
  constructor(
    readonly kind: ProviderKind,
    readonly i18nKey: ProviderUnavailableKey,
    message: string,
  ) {
    super(message);
  }
}

/** The model answered, but twice with output that failed the schema. */
export class LlmOutputError extends Error {
  override name = "LlmOutputError";
  constructor(
    readonly kind: ProviderKind,
    /** Human-readable validation problems of the last attempt. */
    readonly issues: string,
  ) {
    super(`${kind} output failed validation after a repair retry: ${issues}`);
  }
}

/**
 * The call itself failed: HTTP error, network, a non-zero exit, a timeout. The message is scrubbed
 * of secrets and the original error is deliberately not attached — SDK errors can carry request data.
 */
export class LlmProviderError extends Error {
  override name = "LlmProviderError";
  constructor(
    readonly kind: ProviderKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const KEY_LIKE = /\b(?:sk|or|pk)-[A-Za-z0-9_-]{8,}/g;

/** Replaces every given secret, and anything that looks like an API key, with `[redacted]`. */
export function scrubSecrets(text: string, secrets: readonly string[] = []): string {
  let scrubbed = text;
  for (const secret of secrets) {
    if (secret) scrubbed = scrubbed.split(secret).join("[redacted]");
  }
  return scrubbed.replace(KEY_LIKE, "[redacted]");
}

/** An HTTP 401/403: the key is wrong or lacks access, which no fallback can paper over. */
export function isAuthError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = Number(error.status);
  return status === 401 || status === 403;
}

/** Wraps any thrown value into an `LlmProviderError` whose message cannot leak `secrets`. */
export function toProviderError(
  kind: ProviderKind,
  error: unknown,
  secrets: readonly string[] = [],
): LlmProviderError {
  if (error instanceof LlmProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number(error.status) || undefined
      : undefined;
  return new LlmProviderError(
    kind,
    `${kind} request failed: ${scrubSecrets(message, secrets)}`,
    status,
  );
}
