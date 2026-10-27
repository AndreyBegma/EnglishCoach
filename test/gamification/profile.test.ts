import { describe, expect, test } from "bun:test";
import { createI18n, SUPPORTED_LOCALES } from "../../src/bot/i18n";
import { type ProfileData, renderProfile, xpBar } from "../../src/gamification/profile";
import { profileLevel } from "../../src/gamification/xp";
import { encodeProgressCallback, parseProgressCallback } from "../../src/progress/callbacks";
import { MAX_MESSAGE_LENGTH } from "../../src/progress/render";

const i18n = createI18n();

const data = (overrides: Partial<ProfileData> = {}): ProfileData => ({
  // Under 1000: Fluent groups thousands per locale ("1,234", "1 234").
  xp: 734,
  level: profileLevel(734),
  streak: { current: 4, best: 9 },
  cefr: "B1.6",
  skills: [
    { skill: "grammar", label: "B1.4", practised: true },
    { skill: "vocabulary", label: "B2.1", practised: true },
    { skill: "reading", label: "B1.5", practised: false },
  ],
  achievements: [],
  totals: { wordsLearned: 321, reviews: 567, grammarAnswered: 890, goalDays: 42 },
  ...overrides,
});

describe("profile screen", () => {
  for (const locale of SUPPORTED_LOCALES) {
    test(`renders in ${locale} with every block, under the message limit`, () => {
      const { text, keyboard } = renderProfile(i18n, locale, data());
      expect(text.length).toBeLessThan(MAX_MESSAGE_LENGTH);
      expect(text).not.toContain("profile-");
      expect(text).not.toContain("progress-");
      expect(text).toContain("734 XP");
      expect(text).toContain(`${profileLevel(734).level}`);
      expect(text).toContain("B1.6");
      expect(text).toContain("B2.1");
      expect(text).toContain("~B1.5");
      expect(text).toContain("567");
      expect(text).toContain(xpBar(profileLevel(734).into, profileLevel(734).needed));
      expect(keyboard.inline_keyboard.flat()).toHaveLength(1);
    });
  }

  test("a learner with nothing yet still gets a full screen", () => {
    const { text } = renderProfile(
      i18n,
      "en",
      data({
        xp: 0,
        level: profileLevel(0),
        streak: { current: 0, best: 0 },
        cefr: null,
        skills: [],
        totals: { wordsLearned: 0, reviews: 0, grammarAnswered: 0, goalDays: 0 },
      }),
    );
    expect(text).toContain("Level 1 · 0 XP");
    expect(text).toContain("level not set yet");
    expect(text).toContain("Achievements are coming soon.");
  });

  test("shows the latest three achievements, and stays under the limit with long titles", () => {
    const titles = ["First", "Second", "Third", "Fourth"].map((n) => `${n} ${"x".repeat(3000)}`);
    const { text } = renderProfile(i18n, "ru", data({ achievements: titles }));
    expect(text.length).toBeLessThan(MAX_MESSAGE_LENGTH);
    expect(text).toContain("42");
    const short = renderProfile(i18n, "en", data({ achievements: ["A", "B", "C", "D"] })).text;
    expect(short).toContain("• C");
    expect(short).not.toContain("• D");
  });

  test("the XP bar fills in tenths", () => {
    expect(xpBar(0, 100)).toBe("▱▱▱▱▱▱▱▱▱▱");
    expect(xpBar(55, 100)).toBe("▰▰▰▰▰▱▱▱▱▱");
    expect(xpBar(99, 100)).toBe("▰▰▰▰▰▰▰▰▰▱");
  });

  test("the hub's profile button round-trips through the progress codec", () => {
    const data = encodeProgressCallback({ type: "profile" });
    expect(parseProgressCallback(data)).toEqual({ type: "profile" });
  });
});
