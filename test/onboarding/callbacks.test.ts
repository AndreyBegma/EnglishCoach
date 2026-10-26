import { describe, expect, test } from "bun:test";
import { MAX_CALLBACK_BYTES, parseCallback } from "../../src/bot/callbacks";
import {
  encodeOnboardingCallback,
  type OnboardingCallback,
  parseOnboardingCallback,
} from "../../src/onboarding/callbacks";

describe("onboarding callback data", () => {
  test.each<OnboardingCallback>([
    { type: "lang", lang: "uk" },
    { type: "provider", choice: "server" },
    { type: "provider", choice: "own" },
    { type: "take-test" },
    { type: "know-level" },
    { type: "level", level: "C2" },
    { type: "answer", index: 3 },
    { type: "continue" },
    { type: "words", count: 15 },
    { type: "morning", time: "06:30" },
    { type: "evening", time: "22:30" },
    { type: "retry" },
    { type: "cancel" },
  ])("round-trips %j within the Telegram limit", (callback) => {
    const data = encodeOnboardingCallback(callback);
    expect(data.startsWith("1:o:")).toBe(true);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(MAX_CALLBACK_BYTES);
    expect(parseOnboardingCallback(data)).toEqual(callback);
  });

  test.each([
    undefined,
    "",
    "1:h:main",
    "2:o:t",
    "1:o",
    "1:o:zz",
    "1:o:a:4",
    "1:o:lv:D1",
    "1:o:wd:7",
    "1:o:mt:0800",
    "1:o:et:0830",
    "1:o:l:fr",
  ])("rejects %p", (data) => {
    expect(parseOnboardingCallback(data)).toBeUndefined();
  });

  test("the central codec treats onboarding buttons as stale, so it never mishandles them", () => {
    expect(parseCallback(encodeOnboardingCallback({ type: "take-test" }))).toBeUndefined();
  });
});
