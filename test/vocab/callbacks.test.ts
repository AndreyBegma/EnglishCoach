import { describe, expect, test } from "bun:test";
import { parseCallback } from "../../src/bot/callbacks";
import {
  encodeVocabCallback,
  isVocabCallbackData,
  parseVocabCallback,
  type VocabCallback,
} from "../../src/vocab/callbacks";
import { normaliseAnswer } from "../../src/vocab/review";

describe("vocabulary callback codec", () => {
  const all: VocabCallback[] = [
    { op: "got-it", cardId: 42 },
    { op: "choice", cardId: 9_999_999_999, index: 3 },
    { op: "rate", cardId: 7, rating: "again" },
    { op: "rate", cardId: 7, rating: "hard" },
    { op: "rate", cardId: 7, rating: "good" },
    { op: "rate", cardId: 7, rating: "easy" },
    { op: "reveal", cardId: 5 },
    { op: "start" },
    { op: "add-word" },
    { op: "add-cancel" },
    { op: "retry" },
    { op: "finish" },
  ];

  test.each(all)("round-trips %o within 64 bytes", (callback) => {
    const data = encodeVocabCallback(callback);
    expect(data.startsWith("1:v:")).toBe(true);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseVocabCallback(data)).toEqual(callback);
    expect(isVocabCallbackData(data)).toBe(true);
    // The hub's codec does not claim these buttons.
    expect(parseCallback(data)).toBeUndefined();
  });

  test.each([
    "2:v:g:1",
    "1:v:c:1:4",
    "1:v:r:1:x",
    "1:v:g:abc",
    "1:v:g",
    "1:v:zz",
    "1:h:main",
    "",
  ])("rejects %p", (data) => {
    expect(parseVocabCallback(data)).toBeUndefined();
  });

  test("a stale vocabulary button is still recognised as one, so the hub never handles it", () => {
    expect(isVocabCallbackData("2:v:g:1")).toBe(true);
    expect(isVocabCallbackData("1:h:main")).toBe(false);
  });
});

describe("normaliseAnswer", () => {
  test.each([
    [" Decision. ", "decision"],
    ["“Make  up”!", "make up"],
    ["DON'T", "don't"],
  ])("%p → %p", (input, output) => {
    expect(normaliseAnswer(input)).toBe(output);
  });
});
