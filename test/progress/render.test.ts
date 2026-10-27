import { describe, expect, test } from "bun:test";
import { createI18n, SUPPORTED_LOCALES } from "../../src/bot/i18n";
import type { Mistake } from "../../src/db/schema";
import type { ProgressData } from "../../src/progress/queries";
import {
  MAX_MESSAGE_LENGTH,
  renderProgress,
  renderWeakSpots,
  sparkline,
} from "../../src/progress/render";

const i18n = createI18n();

const long = "очень длинный шаблон ошибки ".repeat(20);
const mistake = (n: number, patternText = long): Mistake => ({
  id: n,
  userId: 1,
  category: "grammar",
  pattern: `${n} ${patternText}`,
  exampleWrong: `${long}wrong`,
  exampleRight: `${long}right`,
  explanation: long,
  count: 1_000_000 + n,
  lastSeenAt: new Date("2026-03-01T00:00:00Z"),
  cardId: null,
  topicId: null,
});

const data = (overrides: Partial<ProgressData> = {}): ProgressData => ({
  level: {
    overall: "B1.6",
    skills: [
      { skill: "grammar", label: "B1.4" },
      { skill: "vocabulary", label: "B2.1" },
    ],
  },
  wordsPerDay: 5,
  streak: { current: 4, best: 6 },
  today: { newWords: 3, reviews: 7, goalMet: true },
  cards: {
    new: 2,
    learning: 2,
    review: 3,
    dueToday: 3,
    dueTomorrow: 2,
    wordsLearned: 5,
    wordsKnown: 0,
  },
  activity: [0, 0, 19, 5, 10, 11, 15],
  grammar: { answered7: 15, correct7: 13, answered30: 25, correct30: 18 },
  weak: [mistake(1), mistake(2), mistake(3), mistake(4), mistake(5)],
  ...overrides,
});

describe("sparkline", () => {
  test("scales to the busiest day and keeps quiet days at the lowest block", () => {
    expect(sparkline([0, 0, 19, 5, 10, 11, 15])).toBe("▁▁█▃▅▆▇");
    expect(sparkline([0, 0, 0])).toBe("▁▁▁");
    expect(sparkline([])).toBe("");
  });
});

describe("Progress screen", () => {
  test("shows every block with the expected numbers", () => {
    const { text, keyboard } = renderProgress(i18n, "en", data({ weak: [mistake(1, "articles")] }));
    expect(text).toContain("Level: B1.6");
    expect(text).toContain("📊 Grammar B1.4 · Vocabulary B2.1");
    expect(text).toContain("Streak: 4 (best: 6)");
    expect(text).toContain("Today: 3/5 new words · 7 reviews ✅");
    expect(text).toContain("Cards: 2 new · 2 learning · 3 review");
    expect(text).toContain("Due: 3 today · 2 tomorrow");
    expect(text).toContain("Words learned: 5");
    expect(text).toContain("Last 7 days: ▁▁█▃▅▆▇");
    expect(text).toContain("Grammar accuracy: 87% (7 days) · 72% (30 days)");
    expect(text).toContain("1 articles");
    expect(keyboard.inline_keyboard.flat().map((b) => b.text)).toEqual(["🎯 Weak spots", "← Back"]);
  });

  test("a new learner sees dashes and no weak spots button", () => {
    const empty = data({
      level: null,
      weak: [],
      grammar: { answered7: 0, correct7: 0, answered30: 0, correct30: 0 },
    });
    const { text, keyboard } = renderProgress(i18n, "en", empty);
    expect(text).toContain("Level: not set yet");
    expect(text).toContain("— (7 days) · — (30 days)");
    expect(text).toContain("No mistakes recorded yet");
    expect(keyboard.inline_keyboard.flat()).toHaveLength(1);
  });

  for (const locale of SUPPORTED_LOCALES) {
    test(`fits one Telegram message with a large fixture in ${locale}`, () => {
      const huge = data({
        streak: { current: 99_999, best: 99_999 },
        cards: {
          new: 9_999_999,
          learning: 9_999_999,
          review: 9_999_999,
          dueToday: 9_999_999,
          dueTomorrow: 9_999_999,
          wordsLearned: 9_999_999,
          wordsKnown: 9_999_999,
        },
        today: { newWords: 9_999, reviews: 9_999_999, goalMet: true },
      });
      const { text } = renderProgress(i18n, locale, huge);
      expect(text.length).toBeLessThan(MAX_MESSAGE_LENGTH);
      expect(text).not.toMatch(/\{ \$|progress-/); // no unresolved placeholder or missing key
    });

    test(`Weak spots fits one message in ${locale}`, () => {
      const many = Array.from({ length: 10 }, (_, i) => mistake(i + 1));
      const { text, keyboard } = renderWeakSpots(i18n, locale, many);
      expect(text.length).toBeLessThan(MAX_MESSAGE_LENGTH);
      expect(text).not.toMatch(/\{ \$|progress-/);
      expect(keyboard.inline_keyboard).toHaveLength(2);
    });
  }

  test("the guard trims lines when a screen would still be too long", () => {
    // 200 weak spots is not reachable through the loaders; the guard is the last line of defence.
    const many = Array.from({ length: 200 }, (_, i) => mistake(i + 1));
    expect(renderWeakSpots(i18n, "ru", many).text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
  });
});
