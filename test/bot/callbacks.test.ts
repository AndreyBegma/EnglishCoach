import { describe, expect, test } from "bun:test";
import {
  type Callback,
  encodeCallback,
  MAX_CALLBACK_BYTES,
  parseCallback,
} from "../../src/bot/callbacks";

describe("callback data", () => {
  test.each<Callback>([
    { type: "screen", screen: "main" },
    { type: "screen", screen: "progress" },
    { type: "activity", activity: "review" },
    { type: "lang", lang: "uk" },
    { type: "session-cancel", sessionId: 123456 },
    { type: "session-keep" },
    { type: "settings", page: "root" },
    { type: "settings", page: "morning", n: 1 },
    { type: "settings", page: "model", n: 12 },
    { type: "set", change: { field: "explainLang", value: "ru" } },
    { type: "set", change: { field: "cefrLevel", value: "B2" } },
    { type: "set", change: { field: "wordsPerDay", value: 15 } },
    { type: "set", change: { field: "timezone", value: "America/Los_Angeles" } },
    { type: "set", change: { field: "morningTime", value: "07:30" } },
    { type: "set", change: { field: "eveningTime", value: "23:00" } },
    { type: "set", change: { field: "remindersEnabled", value: false } },
    { type: "set", change: { field: "voiceEnabled", value: true } },
    { type: "set", change: { field: "englishVariant", value: "uk" } },
    { type: "provider", choice: "openrouter" },
    { type: "provider", choice: "claude-code" },
    { type: "provider-key", choice: "custom" },
    { type: "provider-reuse", choice: "anthropic" },
    { type: "model", index: 37 },
    { type: "model", index: "default" },
    { type: "input", input: "timezone" },
    { type: "input", input: "workspace" },
    { type: "input-cancel" },
    { type: "provider-test" },
    { type: "provider-workspace-clear" },
    { type: "placement" },
  ])("round-trips %p", (callback) => {
    const data = encodeCallback(callback);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(MAX_CALLBACK_BYTES);
    expect(data.startsWith("1:")).toBe(true);
    expect(parseCallback(data)).toEqual(callback);
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["older version", "0:h:main"],
    ["newer version", "2:h:main"],
    ["no version", "h:main"],
    ["unknown route", "1:zz:main"],
    ["unknown screen", "1:h:admin"],
    ["unsupported language", "1:l:de"],
    ["non-numeric session id", "1:sc:abc"],
    ["extra segment", "1:sk:1"],
    ["missing argument", "1:h"],
    ["oversize", `1:h:${"x".repeat(80)}`],
    ["settings as a hub screen (moved to s:root)", "1:h:settings"],
    ["unknown settings page", "1:s:admin"],
    ["words per day off the list", "1:sv:wd:7"],
    ["time off the half-hour grid", "1:sv:mt:0815"],
    ["time out of range", "1:sv:et:2500"],
    ["timezone index out of range", "1:sv:tz:99"],
    ["unknown setting", "1:sv:zz:1"],
    ["non-boolean toggle", "1:sv:rm:yes"],
    ["key for a keyless provider", "1:pk:server"],
    ["unknown provider", "1:pv:gemini"],
    ["model index not a number", "1:pm:abc"],
  ])("rejects %s data", (_, data) => {
    expect(parseCallback(data)).toBeUndefined();
  });
});
