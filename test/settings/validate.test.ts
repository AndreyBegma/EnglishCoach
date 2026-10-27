import { describe, expect, test } from "bun:test";
import { MAX_INTERESTS } from "../../src/settings/options";
import {
  mergeInterests,
  parseApiKey,
  parseBaseUrl,
  parseInterests,
  parseModelId,
  parseProfession,
  parseTimezone,
  parseWorkspaceId,
  timezoneAt,
  toggleInterest,
} from "../../src/settings/validate";

describe("learner profile text", () => {
  test("interests are split on commas, semicolons and new lines, and tidied", () => {
    expect(parseInterests(" jazz ,  indie   games;\nhiking\u0007 ,, ")).toEqual([
      "jazz",
      "indie games",
      "hiking",
    ]);
  });

  test("empty, over-long or key-shaped interests are refused", () => {
    expect(parseInterests(" , ; ")).toBeUndefined();
    expect(parseInterests(`jazz, ${"x".repeat(41)}`)).toBeUndefined();
    expect(parseInterests("jazz, sk-ant-api03-abcdefghijk")).toBeUndefined();
  });

  test("merging drops case-insensitive repeats and stops at the limit", () => {
    expect(mergeInterests(["Jazz"], ["jazz", "chess"])).toEqual(["Jazz", "chess"]);
    const many = Array.from({ length: MAX_INTERESTS + 3 }, (_, i) => `topic ${i}`);
    expect(mergeInterests([], many)).toHaveLength(MAX_INTERESTS);
  });

  test("toggling adds a missing interest and removes a present one", () => {
    expect(toggleInterest(["music"], "books")).toEqual(["music", "books"]);
    expect(toggleInterest(["Music", "books"], "music")).toEqual(["books"]);
  });

  test("a profession is one tidy line of at most 80 characters", () => {
    expect(parseProfession("  Backend\n developer ")).toBe("Backend developer");
    expect(parseProfession("   ")).toBeUndefined();
    expect(parseProfession("x".repeat(81))).toBeUndefined();
    expect(parseProfession("sk-or-v1-0123456789abcdef")).toBeUndefined();
  });
});

describe("parseBaseUrl", () => {
  test.each([
    ["https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1"],
    ["  https://llm.example.com/v1/  ", "https://llm.example.com/v1"],
    ["https://llm.example.com:8443/v1?x=1#y", "https://llm.example.com:8443/v1"],
    ["https://8.8.8.8/v1", "https://8.8.8.8/v1"],
    ["https://[2001:db8::1]/v1", "https://[2001:db8::1]/v1"],
  ])("accepts %s", (input, expected) => {
    expect(parseBaseUrl(input)).toBe(expected);
  });

  test.each([
    ["plain http", "http://llm.example.com/v1"],
    ["not a URL", "openrouter"],
    ["another scheme", "file:///etc/passwd"],
    ["credentials", "https://user:pass@llm.example.com/v1"],
    ["localhost", "https://localhost:8080/v1"],
    ["a .localhost name", "https://api.localhost/v1"],
    ["loopback", "https://127.0.0.1/v1"],
    ["loopback in decimal", "https://2130706433/v1"],
    ["loopback in hex", "https://0x7f.0.0.1/v1"],
    ["unspecified", "https://0.0.0.0/v1"],
    ["10/8", "https://10.1.2.3/v1"],
    ["172.16/12", "https://172.20.0.5/v1"],
    ["192.168/16", "https://192.168.1.10/v1"],
    ["link-local / cloud metadata", "https://169.254.169.254/latest"],
    ["carrier-grade NAT", "https://100.64.0.1/v1"],
    ["IPv6 loopback", "https://[::1]/v1"],
    ["IPv6 unique local", "https://[fd12:3456::1]/v1"],
    ["IPv6 link-local", "https://[fe80::1]/v1"],
    ["IPv4-mapped loopback", "https://[::ffff:127.0.0.1]/v1"],
    ["IPv4-mapped private", "https://[::ffff:10.0.0.1]/v1"],
  ])("rejects %s", (_, input) => {
    expect(parseBaseUrl(input)).toBeUndefined();
  });
});

describe("parseTimezone", () => {
  test.each([
    ["Europe/Kyiv", "Europe/Kyiv"],
    ["asia/tokyo", "Asia/Tokyo"],
    [" America/Argentina/Buenos_Aires ", "America/Argentina/Buenos_Aires"],
    ["UTC", "UTC"],
  ])("accepts %s", (input, expected) => {
    expect(parseTimezone(input)).toBe(expected);
  });

  test.each(["Mars/Olympus", "+03:00", "GMT+3", "Kyiv", "", "Europe/Kyiv; drop"])(
    "rejects %p",
    (input) => {
      expect(parseTimezone(input)).toBeUndefined();
    },
  );
});

describe("timezoneAt", () => {
  test("finds the zone of a location", () => {
    expect(timezoneAt(50.45, 30.52)).toBe(parseTimezone("Europe/Kyiv"));
    expect(timezoneAt(35.68, 139.69)).toBe("Asia/Tokyo");
  });

  test("returns undefined for an impossible location", () => {
    expect(timezoneAt(123, 456)).toBeUndefined();
  });
});

describe("parseModelId and parseApiKey", () => {
  test("model IDs as providers spell them", () => {
    expect(parseModelId(" anthropic/claude-sonnet-5-5:beta ")).toBe(
      "anthropic/claude-sonnet-5-5:beta",
    );
    expect(parseModelId("two words")).toBeUndefined();
    expect(parseModelId("")).toBeUndefined();
  });

  test("an API key is one token", () => {
    expect(parseApiKey("  sk-ant-abc123456789  ")).toBe("sk-ant-abc123456789");
    expect(parseApiKey("my key is sk-ant-abc123456789")).toBeUndefined();
    expect(parseApiKey("short")).toBeUndefined();
  });
});

describe("parseWorkspaceId", () => {
  test("an Anthropic workspace ID, trimmed", () => {
    expect(parseWorkspaceId(" wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ ")).toBe(
      "wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ",
    );
  });

  test("keys and anything else are refused, so a key never lands in the plain-text column", () => {
    expect(parseWorkspaceId("sk-ant-usr-abc123456789")).toBeUndefined();
    expect(parseWorkspaceId("wrkspc_short")).toBeUndefined();
    expect(parseWorkspaceId("my workspace")).toBeUndefined();
    expect(parseWorkspaceId("")).toBeUndefined();
  });
});
