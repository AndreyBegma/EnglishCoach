import { describe, expect, test } from "bun:test";
import { MAX_CALLBACK_BYTES, parseCallback } from "../../src/bot/callbacks";
import { encodeGrammarCallback, parseGrammarCallback } from "../../src/grammar/callbacks";
import { matchesAccepted, normaliseAnswer } from "../../src/grammar/grading";
import { localDate } from "../../src/grammar/stats";
import { GRAMMAR_TOPICS, topicsForLevel } from "../../src/grammar/topics";

describe("grammar callbacks", () => {
  const all = [
    { type: "topic", index: null },
    { type: "topic", index: 9 },
    { type: "answer", question: 10, option: 3 },
    { type: "retry" },
    { type: "stop" },
  ] as const;

  test("round-trip within Telegram's limit, and the shared codec ignores them", () => {
    for (const callback of all) {
      const data = encodeGrammarCallback(callback);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(MAX_CALLBACK_BYTES);
      expect(parseGrammarCallback(data)).toEqual(callback);
      expect(parseCallback(data)).toBeUndefined();
    }
  });

  test("stale, foreign and malformed data does not parse", () => {
    for (const data of [
      "2:g:x",
      "1:h:main",
      "1:g:a:1",
      "1:g:a:x:1",
      "1:g:t:-1",
      "1:g:r:1",
      "",
      "g:x",
    ]) {
      expect(parseGrammarCallback(data)).toBeUndefined();
    }
    expect(parseGrammarCallback(undefined)).toBeUndefined();
  });
});

describe("grammar topics", () => {
  test("the list is filtered by level; unset means intermediate", () => {
    const ids = (level: Parameters<typeof topicsForLevel>[0]) =>
      topicsForLevel(level).map(({ topic }) => topic.id);
    expect(ids("A1")).toEqual(["tenses", "articles", "prepositions", "comparatives"]);
    expect(ids("C2")).toEqual([
      "tenses",
      "conditionals",
      "modals",
      "passive",
      "reported_speech",
      "gerund_infinitive",
      "relative_clauses",
    ]);
    expect(ids(null)).toEqual(ids("B1"));
    expect(ids("B1")).toHaveLength(GRAMMAR_TOPICS.length);
  });

  test("callback indexes point at the same topic in the full list", () => {
    for (const { index, topic } of topicsForLevel("B2")) {
      expect(GRAMMAR_TOPICS[index]).toBe(topic);
    }
  });
});

describe("answer matching", () => {
  test("ignores case, spacing, curly apostrophes and a closing full stop", () => {
    expect(normaliseAnswer("  She’s   LIVED. ")).toBe("she's lived");
    expect(matchesAccepted("she's lived", ["has lived", "She's lived."])).toBe(true);
    expect(matchesAccepted("has live", ["has lived"])).toBe(false);
    expect(matchesAccepted("  ", ["has lived"])).toBe(false);
  });
});

describe("localDate", () => {
  test("uses the learner's timezone, and UTC for an invalid one", () => {
    const instant = new Date("2026-10-26T22:30:00Z");
    expect(localDate(instant, "Europe/Kyiv")).toBe("2026-10-27");
    expect(localDate(instant, "America/New_York")).toBe("2026-10-26");
    expect(localDate(instant, "Not/AZone")).toBe("2026-10-26");
  });
});
