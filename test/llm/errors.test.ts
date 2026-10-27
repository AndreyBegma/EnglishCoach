import { describe, expect, test } from "bun:test";
import {
  DETAIL_MAX_LENGTH,
  describeProviderError,
  LlmOutputError,
  LlmProviderError,
  PROVIDER_UNAVAILABLE_KEYS,
  type ProviderErrorClass,
  ProviderUnavailableError,
  toProviderError,
} from "../../src/llm/errors";

const apiKey = "sk-ant-api03-secretsecretsecret-a1b2";

/** An Anthropic SDK `APIError` as far as the mapper reads it. */
function anthropicError(status: number, type: string, message: string) {
  return Object.assign(
    new Error(`${status} ${JSON.stringify({ type: "error", error: { type, message } })}`),
    {
      status,
      error: { type: "error", error: { type, message } },
    },
  );
}

/** An OpenAI SDK `APIError`: the inner error object sits on `.error`. */
function openAiError(status: number, code: string, message: string) {
  return Object.assign(new Error(`${status} ${message}`), {
    status,
    code,
    error: { message, type: code, code },
  });
}

const classOf = (error: unknown) =>
  describeProviderError(toProviderError("anthropic", error, [apiKey]));

describe("describeProviderError", () => {
  test.each<[string, unknown, ProviderErrorClass]>([
    ["401 invalid key", anthropicError(401, "authentication_error", "invalid x-api-key"), "auth"],
    ["403 permission", anthropicError(403, "permission_error", "no access to model"), "permission"],
    [
      "400 workspace missing",
      anthropicError(
        400,
        "invalid_request_error",
        "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header.",
      ),
      "workspace",
    ],
    ["404 unknown model", anthropicError(404, "not_found_error", "model: claude-x"), "model"],
    [
      "400 unknown model (OpenAI-compatible)",
      openAiError(400, "model_not_found", "The model `gpt-x` does not exist"),
      "model",
    ],
    [
      "429 rate limit",
      anthropicError(429, "rate_limit_error", "Number of requests exceeded"),
      "rate-limit",
    ],
    [
      "400 out of credits (Anthropic)",
      anthropicError(
        400,
        "invalid_request_error",
        "Your credit balance is too low to access the API.",
      ),
      "credits",
    ],
    [
      "429 out of credits (OpenAI)",
      openAiError(429, "insufficient_quota", "You exceeded your quota"),
      "credits",
    ],
    ["529 overloaded", anthropicError(529, "overloaded_error", "Overloaded"), "overloaded"],
    ["500 api error", anthropicError(500, "api_error", "Internal server error"), "overloaded"],
    [
      "400 other",
      anthropicError(400, "invalid_request_error", "max_tokens: too large"),
      "bad-request",
    ],
    ["no status", new Error("fetch failed: ECONNRESET"), "network"],
  ])("%s", (_name, error, expected) => {
    const described = classOf(error);
    expect(described.class).toBe(expected);
    expect(described.key).toBe(`provider-error-${expected}`);
  });

  test("the provider's message is carried as detail; status as a variable", () => {
    const described = classOf(anthropicError(529, "overloaded_error", "Overloaded"));
    expect(described.detail).toBe("Overloaded");
    expect(described.vars).toEqual({ status: 529 });
  });

  test("unavailable, bad output and foreign errors get their own keys and no detail", () => {
    expect(
      describeProviderError(
        new ProviderUnavailableError("runner", PROVIDER_UNAVAILABLE_KEYS.runner, "not yet"),
      ),
    ).toEqual({ class: "unavailable", key: "provider-unavailable-runner", vars: {} });
    expect(describeProviderError(new LlmOutputError("anthropic", "bad")).class).toBe("bad-output");
    const foreign = describeProviderError(new TypeError(`boom ${apiKey}`));
    expect(foreign.class).toBe("unknown");
    expect(foreign.detail).toBeUndefined();
  });
});

describe("detail is safe to show", () => {
  test("the key, any key-like token and a provider-masked key are redacted", () => {
    const error = toProviderError(
      "openai",
      openAiError(
        401,
        "invalid_api_key",
        `Incorrect API key provided: sk-proj-abc***********wxyz. Also ${apiKey} and sk-or-v1-0123456789abcdef.`,
      ),
      [apiKey],
    );
    expect(error.detail).toBe(
      "Incorrect API key provided: [redacted]. Also [redacted] and [redacted].",
    );
    expect(error.message).not.toContain(apiKey);
  });

  test("detail is capped and flattened to one line", () => {
    const error = toProviderError(
      "anthropic",
      anthropicError(400, "invalid_request_error", `first line\n\n${"x".repeat(500)}`),
    );
    expect(error.detail?.length).toBe(DETAIL_MAX_LENGTH);
    expect(error.detail).not.toContain("\n");
    expect(error.detail?.endsWith("…")).toBe(true);
  });

  test("an already wrapped error passes through unchanged", () => {
    const wrapped = new LlmProviderError("anthropic", "m", 429, "slow down", "rate_limit_error");
    expect(toProviderError("anthropic", wrapped)).toBe(wrapped);
  });
});
