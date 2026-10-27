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
    /** The provider's own `error.message`, scrubbed and capped: safe to show the user. */
    readonly detail?: string,
    /** The provider's error type or code, e.g. `rate_limit_error`, `insufficient_quota`. */
    readonly code?: string,
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
  const body = errorBody(error);
  const detail = body.message ? safeDetail(body.message, secrets) : undefined;
  return new LlmProviderError(
    kind,
    `${kind} request failed: ${scrubSecrets(message, secrets)}`,
    status,
    detail,
    body.code,
  );
}

/** Longest provider message shown to the user. */
export const DETAIL_MAX_LENGTH = 200;

// Providers echo a rejected key masked (`sk-abc***xyz`); even that fragment is not shown. Runs
// before `scrubSecrets`, which would otherwise redact the prefix and leave the masked tail.
const MASKED_KEY_LIKE = /\b(?:sk|or|pk)-[A-Za-z0-9_*-]{3,}/g;

/** The provider's message as the user may see it: no key material, one line, capped. */
function safeDetail(message: string, secrets: readonly string[]): string | undefined {
  const scrubbed = scrubSecrets(message.replace(MASKED_KEY_LIKE, "[redacted]"), secrets);
  const flat = scrubbed.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > DETAIL_MAX_LENGTH ? `${flat.slice(0, DETAIL_MAX_LENGTH - 1)}…` : flat;
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

/**
 * The provider's error message and type from an SDK error. Anthropic's SDK keeps the whole body
 * (`{ type: "error", error: { type, message } }`) on `.error`; OpenAI's keeps the inner object.
 */
function errorBody(error: unknown): { message?: string; code?: string } {
  const body = field(error, "error");
  const inner = field(body, "error") ?? body;
  return {
    message: text(field(inner, "message")),
    code:
      text(field(inner, "type")) ??
      text(field(inner, "code")) ??
      text(field(error, "type")) ??
      text(field(error, "code")),
  };
}

/** Why a provider call failed, as far as the bot can tell the user. */
export type ProviderErrorClass =
  | "auth"
  | "permission"
  | "workspace"
  | "model"
  | "rate-limit"
  | "credits"
  | "overloaded"
  | "bad-request"
  | "bad-output"
  | "network"
  | "unavailable"
  | "unknown";

/** i18n keys (locales/*.ftl) per class; `unavailable` uses the error's own key. */
export const PROVIDER_ERROR_KEYS = {
  auth: "provider-error-auth",
  permission: "provider-error-permission",
  workspace: "provider-error-workspace",
  model: "provider-error-model",
  "rate-limit": "provider-error-rate-limit",
  credits: "provider-error-credits",
  overloaded: "provider-error-overloaded",
  "bad-request": "provider-error-bad-request",
  "bad-output": "provider-error-bad-output",
  network: "provider-error-network",
  unknown: "provider-error-unknown",
} as const satisfies Record<Exclude<ProviderErrorClass, "unavailable">, string>;

/** A failed provider call as the bot shows it: an i18n key plus the provider's own words. */
export interface ProviderErrorDescription {
  class: ProviderErrorClass;
  key: string;
  vars: Record<string, string | number>;
  /** The provider's message, already scrubbed of secrets and capped. Shown verbatim, if at all. */
  detail?: string;
}

const CREDITS = /credit balance|insufficient_quota|billing|payment required|out of credits/;
const UNKNOWN_MODEL = /model/;
const NOT_FOUND = /not[ _]found|does not exist|unknown|invalid/;

/** Sorts an `LlmProviderError` into a class by status, error type and message. */
export function classifyProviderError(
  error: LlmProviderError,
): Exclude<ProviderErrorClass, "unavailable" | "bad-output"> {
  const { status } = error;
  const said = `${error.code ?? ""} ${error.detail ?? ""}`.toLowerCase();

  if (status === undefined) return "network";
  if (status === 401) return "auth";
  if (status === 402 || CREDITS.test(said)) return "credits";
  if (status === 403) return "permission";
  if (status === 400 && said.includes("workspace")) return "workspace";
  if (status === 404 || (UNKNOWN_MODEL.test(said) && NOT_FOUND.test(said))) return "model";
  if (status === 429) return "rate-limit";
  if (status >= 500 || said.includes("overloaded")) return "overloaded";
  if (status >= 400 && status < 500) return "bad-request";
  return "unknown";
}

/**
 * What to tell the user about any error a provider call threw. Pure: the caller translates `key`
 * with `vars` and may add `detail` on its own line. Nothing here can carry key material — `detail`
 * was scrubbed when the error was wrapped, and anything that is not a provider error says nothing.
 */
export function describeProviderError(error: unknown): ProviderErrorDescription {
  if (error instanceof ProviderUnavailableError) {
    return { class: "unavailable", key: error.i18nKey, vars: {} };
  }
  if (error instanceof LlmOutputError) {
    return { class: "bad-output", key: PROVIDER_ERROR_KEYS["bad-output"], vars: {} };
  }
  if (!(error instanceof LlmProviderError)) {
    return { class: "unknown", key: PROVIDER_ERROR_KEYS.unknown, vars: { status: "—" } };
  }
  const errorClass = classifyProviderError(error);
  return {
    class: errorClass,
    key: PROVIDER_ERROR_KEYS[errorClass],
    vars: { status: error.status ?? "—" },
    ...(error.detail ? { detail: error.detail } : {}),
  };
}
