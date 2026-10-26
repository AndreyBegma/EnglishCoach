import { describe, expect, test } from "bun:test";
import { createLogger, type LogLevel, REDACTED, redact } from "../src/log";

describe("redact", () => {
  test("redacts keys containing key, token or secret, case-insensitively", () => {
    expect(
      redact({
        apiKey: "sk-1",
        MASTER_KEY: "m",
        refresh_token: "t",
        TELEGRAM_BOT_TOKEN: "b",
        clientSecret: "s",
        keyboard: "k",
        user: "alice",
        count: 3,
      }),
    ).toEqual({
      apiKey: REDACTED,
      MASTER_KEY: REDACTED,
      refresh_token: REDACTED,
      TELEGRAM_BOT_TOKEN: REDACTED,
      clientSecret: REDACTED,
      // "keyboard" contains "key": the rule is deliberately broad; a false positive is cheap.
      keyboard: REDACTED,
      user: "alice",
      count: 3,
    });
  });

  test("redacts at any depth, including inside arrays", () => {
    expect(
      redact({
        provider: { name: "openai", credentials: { secretValue: "x" } },
        list: [{ token: "a" }, 1],
      }),
    ).toEqual({
      provider: { name: "openai", credentials: { secretValue: REDACTED } },
      list: [{ token: REDACTED }, 1],
    });
  });

  test("redacts a whole subtree under a sensitive key", () => {
    expect(redact({ keys: { anthropic: "a", openai: "o" } })).toEqual({ keys: REDACTED });
  });

  test("does not mutate its input", () => {
    const input = { nested: { apiKey: "sk-1" } };
    redact(input);
    expect(input.nested.apiKey).toBe("sk-1");
  });

  test("handles circular references", () => {
    const input: Record<string, unknown> = { name: "loop", token: "t" };
    input.self = input;
    expect(redact(input)).toEqual({ name: "loop", token: REDACTED, self: "[circular]" });
  });

  test("keeps a shared, non-circular object in full", () => {
    const shared = { id: 1 };
    expect(redact({ a: shared, b: shared })).toEqual({ a: { id: 1 }, b: { id: 1 } });
  });

  test("flattens errors and redacts their fields", () => {
    const error = Object.assign(new Error("boom"), { apiKey: "sk-1" });
    const result = redact(error) as Record<string, unknown>;
    expect(result.message).toBe("boom");
    expect(result.name).toBe("Error");
    expect(result.apiKey).toBe(REDACTED);
  });

  test("passes primitives through", () => {
    expect(redact("x")).toBe("x");
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });
});

describe("createLogger", () => {
  function capture(level: LogLevel = "debug") {
    const lines: { line: string; level: LogLevel }[] = [];
    const logger = createLogger({ level, write: (line, at) => lines.push({ line, level: at }) });
    const parsed = () => lines.map(({ line }) => JSON.parse(line) as Record<string, unknown>);
    return { logger, lines, parsed };
  }

  test("writes one JSON line with level and message", () => {
    const { logger, lines, parsed } = capture();
    logger.info("hello", { user: "alice" });
    expect(lines).toHaveLength(1);
    expect(parsed()[0]).toMatchObject({ level: "info", msg: "hello", user: "alice" });
  });

  test("redacts fields and child bindings, and never writes the secret", () => {
    const { logger, lines, parsed } = capture();
    logger.child({ sessionToken: "child-secret" }).warn("auth", { headers: { apiKey: "sk-live" } });
    expect(parsed()[0]).toMatchObject({ sessionToken: REDACTED, headers: { apiKey: REDACTED } });
    expect(lines[0]?.line).not.toContain("sk-live");
    expect(lines[0]?.line).not.toContain("child-secret");
  });

  test("drops entries below the configured level", () => {
    const { logger, parsed } = capture("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(parsed().map((entry) => entry.msg)).toEqual(["w", "e"]);
  });
});
