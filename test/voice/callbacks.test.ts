import { describe, expect, test } from "bun:test";
import { isVocabCallbackData } from "../../src/vocab/callbacks";
import {
  encodeVoiceCallback,
  isVoiceCallbackData,
  parseVoiceCallback,
} from "../../src/voice/callbacks";

describe("voice callbacks", () => {
  test("round trip, within Telegram's limit", () => {
    const data = encodeVoiceCallback({ op: "speak", cardId: 4_000_000_000 });
    expect(data).toBe("1:vo:4000000000");
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseVoiceCallback(data)).toEqual({
      op: "speak",
      cardId: 4_000_000_000,
      target: "word",
    });
  });

  test("the example sentence button carries its own suffix", () => {
    const data = encodeVoiceCallback({ op: "speak", cardId: 7, target: "example" });
    expect(data).toBe("1:vo:7:e");
    expect(parseVoiceCallback(data)).toEqual({ op: "speak", cardId: 7, target: "example" });
    expect(encodeVoiceCallback({ op: "speak", cardId: 7, target: "word" })).toBe("1:vo:7");
  });

  test("stale, foreign and malformed data does not parse", () => {
    for (const data of [
      "2:vo:5",
      "1:vo:",
      "1:vo:x",
      "1:vo:5:6",
      "1:vo:5:x",
      "1:v:g:5",
      undefined,
    ]) {
      expect(parseVoiceCallback(data)).toBeUndefined();
    }
  });

  test("voice buttons are told apart from vocabulary buttons", () => {
    expect(isVoiceCallbackData("1:vo:5")).toBe(true);
    expect(isVoiceCallbackData("1:v:g:5")).toBe(false);
    expect(isVocabCallbackData("1:vo:5")).toBe(false);
  });
});
