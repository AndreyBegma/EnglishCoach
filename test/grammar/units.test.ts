import { describe, expect, test } from "bun:test";
import { MAX_CALLBACK_BYTES, parseCallback } from "../../src/bot/callbacks";
import { createI18n } from "../../src/bot/i18n";
import { encodeGrammarCallback, parseGrammarCallback } from "../../src/grammar/callbacks";
import { matchesAccepted, normaliseAnswer } from "../../src/grammar/grading";
import { topicPicker, transferLines } from "../../src/grammar/screens";
import { localDate } from "../../src/grammar/stats";
import { SYLLABUS, topicById, topicsForLevel } from "../../src/grammar/topics";
import { CEFR_LEVELS } from "../../src/settings/options";

describe("grammar callbacks", () => {
  const all = [
    { type: "topic", id: null },
    { type: "topic", id: "g015" },
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
      "1:g:t:9",
      "1:g:t:g15",
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
  test("the picker offers the learner's band of the syllabus; unset means intermediate", () => {
    for (const level of CEFR_LEVELS) {
      const topics = topicsForLevel(level);
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.every((topic) => topic.band === level)).toBe(true);
    }
    expect(topicsForLevel(null)).toEqual(topicsForLevel("B1"));
    expect(topicsForLevel("B1").map((topic) => topic.id)).toContain("g015");
  });

  test("every topic id fits a topic button", () => {
    for (const topic of SYLLABUS.topics) {
      const data = encodeGrammarCallback({ type: "topic", id: topic.id });
      expect(parseGrammarCallback(data)).toEqual({ type: "topic", id: topic.id });
      expect(topicById(topic.id)).toBe(topic);
    }
  });
});

describe("topic transfer evidence", () => {
  const i18n = createI18n();

  test("correct uses then recent errors, per source; nothing without evidence", () => {
    const summary = { correct: { talk: 3, writing: 1 }, recentErrors: { talk: 1 } };
    expect(transferLines(i18n, "en", summary)).toEqual([
      "✅ Used correctly 3× in conversation",
      "✅ Used correctly 1× in writing",
      "⚠️ Slips in conversation in the last 14 days: 1",
    ]);
    expect(transferLines(i18n, "ru", summary)[0]).toBe("✅ Использовано верно 3× в разговоре");
    expect(transferLines(i18n, "uk", summary)[0]).toBe("✅ Використано правильно 3× у розмові");
    expect(transferLines(i18n, "en", { correct: { talk: 0 }, recentErrors: {} })).toEqual([]);
  });
});

describe("topic picker", () => {
  const i18n = createI18n();
  const [first, second, third] = topicsForLevel("B1");

  test("the next topic leads with its reason, every topic carries its status marker", () => {
    if (!first || !second || !third) throw new Error("B1 has fewer than three topics");
    const progress = new Map([
      [first.id, { status: "mastered" as const, reviewDue: new Date(0) }],
      [second.id, { status: "shaky" as const, reviewDue: null }],
      [third.id, { status: "learning" as const, reviewDue: null }],
    ]);
    const { keyboard } = topicPicker(i18n, "en", "B1", progress, {
      topic: first,
      reason: "review",
    });
    const labels = keyboard.inline_keyboard.map((row) => row.map((button) => button.text));
    expect(labels[0]).toEqual([`🔁 Review: ${first.title.en}`]);
    expect(labels[1]).toEqual(["🎲 Mixed"]);
    expect(labels.slice(2, 5).flat()).toEqual([
      `✅ ${first.title.en}`,
      `🟡 ${second.title.en}`,
      `🔴 ${third.title.en}`,
    ]);
    expect(labels[5]?.[0]).toStartWith("⬜ ");
  });

  test("without a next topic, Mixed comes first", () => {
    const { keyboard } = topicPicker(i18n, "ru", "B1");
    expect(keyboard.inline_keyboard[0]?.[0]?.text).toBe("🎲 Микс");
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
