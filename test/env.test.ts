import { describe, expect, test } from "bun:test";
import { EnvError, parseEnv } from "../src/config/env";

const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

const valid = {
  TELEGRAM_BOT_TOKEN: "123456:secret-token-value",
  DATABASE_URL: "postgres://coach:coach@localhost:55433/coach",
  REDIS_URL: "redis://localhost:56380",
  MASTER_KEY,
};

function errorOf(source: Record<string, string | undefined>): EnvError {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  test("parses a minimal valid environment and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.HTTP_PORT).toBe(18740);
    expect(env.ADMIN_TELEGRAM_IDS).toEqual([]);
    expect(env.CLAUDE_BIN).toBe("claude");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.SERVER_LLM_PROVIDER).toBeUndefined();
  });

  test("treats blank optional values as unset", () => {
    const env = parseEnv({
      ...valid,
      HTTP_PORT: "",
      SERVER_LLM_PROVIDER: "",
      SERVER_OPENAI_BASE_URL: " ",
      ADMIN_TELEGRAM_IDS: "",
    });
    expect(env.HTTP_PORT).toBe(18740);
    expect(env.SERVER_LLM_PROVIDER).toBeUndefined();
    expect(env.SERVER_OPENAI_BASE_URL).toBeUndefined();
  });

  test("parses ADMIN_TELEGRAM_IDS into numbers", () => {
    const env = parseEnv({ ...valid, ADMIN_TELEGRAM_IDS: "111, 222,333" });
    expect(env.ADMIN_TELEGRAM_IDS).toEqual([111, 222, 333]);
  });

  test("rejects a non-numeric admin ID", () => {
    expect(errorOf({ ...valid, ADMIN_TELEGRAM_IDS: "111,abc" }).message).toContain(
      "ADMIN_TELEGRAM_IDS",
    );
  });

  test("names a missing TELEGRAM_BOT_TOKEN", () => {
    const { TELEGRAM_BOT_TOKEN: _, ...rest } = valid;
    expect(errorOf(rest).message).toBe("TELEGRAM_BOT_TOKEN is required");
  });

  test("treats a blank TELEGRAM_BOT_TOKEN as missing", () => {
    expect(errorOf({ ...valid, TELEGRAM_BOT_TOKEN: "  " }).message).toBe(
      "TELEGRAM_BOT_TOKEN is required",
    );
  });

  test("rejects a MASTER_KEY that is not 32 bytes of base64", () => {
    const short = Buffer.alloc(16).toString("base64");
    expect(errorOf({ ...valid, MASTER_KEY: short }).message).toStartWith("MASTER_KEY must be 32");
    expect(errorOf({ ...valid, MASTER_KEY: "not base64!" }).message).toStartWith("MASTER_KEY");
  });

  test("rejects an unknown SERVER_LLM_PROVIDER", () => {
    expect(errorOf({ ...valid, SERVER_LLM_PROVIDER: "gemini" }).message).toContain(
      "SERVER_LLM_PROVIDER must be one of",
    );
  });

  test("reports every problem on one line and never echoes values", () => {
    const message = errorOf({
      MASTER_KEY: "c2hvcnQ=",
      DATABASE_URL: "not-a-url-with-pass-hunter2",
    }).message;
    expect(message).not.toContain("\n");
    expect(message).toContain("TELEGRAM_BOT_TOKEN is required");
    expect(message).toContain("DATABASE_URL must be a URL");
    expect(message).toContain("REDIS_URL is required");
    expect(message).toContain("MASTER_KEY");
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("c2hvcnQ=");
  });

  test("defaults the bot to polling with a 20 minute session timeout and no demo", () => {
    const env = parseEnv(valid);
    expect(env.BOT_MODE).toBe("polling");
    expect(env.SESSION_TIMEOUT_MINUTES).toBe(20);
    expect(env.ENABLE_DEMO_SESSION).toBe(false);
  });

  test("parses ENABLE_DEMO_SESSION", () => {
    expect(parseEnv({ ...valid, ENABLE_DEMO_SESSION: "true" }).ENABLE_DEMO_SESSION).toBe(true);
    expect(errorOf({ ...valid, ENABLE_DEMO_SESSION: "yes" }).message).toContain(
      "ENABLE_DEMO_SESSION",
    );
  });

  test("webhook mode requires a secret and a public URL", () => {
    const message = errorOf({ ...valid, BOT_MODE: "webhook" }).message;
    expect(message).toContain("TELEGRAM_WEBHOOK_SECRET is required in webhook mode");
    expect(message).toContain("PUBLIC_URL is required in webhook mode");

    const env = parseEnv({
      ...valid,
      BOT_MODE: "webhook",
      TELEGRAM_WEBHOOK_SECRET: "a".repeat(32),
      PUBLIC_URL: "https://coach.example.com",
    });
    expect(env.BOT_MODE).toBe("webhook");
  });

  test("rejects a webhook secret with characters Telegram does not allow", () => {
    const message = errorOf({ ...valid, TELEGRAM_WEBHOOK_SECRET: "short/secret" }).message;
    expect(message).toContain("TELEGRAM_WEBHOOK_SECRET");
    expect(message).not.toContain("short/secret");
  });
});
