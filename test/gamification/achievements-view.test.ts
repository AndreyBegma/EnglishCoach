import { describe, expect, test } from "bun:test";
import type { InlineKeyboard } from "grammy";
import { createI18n, SUPPORTED_LOCALES } from "../../src/bot/i18n";
import {
  type Achievement,
  achievementCatalogue,
  inSeason,
  localClock,
  PAGE_SERIES,
  renderAchievements,
  unlockNotice,
} from "../../src/gamification/achievements";
import { xpBar } from "../../src/gamification/profile";
import { renderScreen } from "../../src/hub/screens";
import { parseProgressCallback } from "../../src/progress/callbacks";
import { MAX_MESSAGE_LENGTH } from "../../src/progress/render";

const i18n = createI18n();
const catalogue = achievementCatalogue();
const entry = (id: string) => catalogue.byId.get(id) as Achievement;

const callbacks = (keyboard: InlineKeyboard) =>
  keyboard.inline_keyboard
    .flat()
    .map((button) =>
      parseProgressCallback("callback_data" in button ? button.callback_data : undefined),
    );

describe("achievements screen", () => {
  const data = {
    unlocked: new Set(["words_learned_1", "words_learned_10", "secret_deep_night"]),
    counters: new Map([["words_learned", 17]]),
  };

  for (const locale of SUPPORTED_LOCALES) {
    test(`every page renders in ${locale}, under the limit, without raw keys`, () => {
      for (let page = 0; page < 20; page++) {
        const { text } = renderAchievements(i18n, locale, data, page, catalogue);
        expect(text.length).toBeLessThan(MAX_MESSAGE_LENGTH);
        expect(text).not.toContain("achievements-");
        expect(text).not.toContain("{n}");
      }
    });
  }

  const everyPage = (shown: typeof data) =>
    Array.from(
      { length: Math.ceil(catalogue.series.length / PAGE_SERIES) + 1 },
      (_, page) => renderAchievements(i18n, "en", shown, page, catalogue).text,
    ).join("\n");

  test("the first page shows the count and the topics; a series its latest step and next one", () => {
    const { text, keyboard } = renderAchievements(i18n, "en", data, 0, catalogue);
    expect(text).toContain(`3 of ${catalogue.entries.length} unlocked`);
    expect(text).toContain(`Grammar topics mastered: 0 of`);
    const all = everyPage(data);
    expect(all).toContain(`${entry("words_learned_10").title.en} 🥉`);
    expect(all).toContain(`${xpBar(17, 25)} 17/25 → ${entry("words_learned_25").title.en}`);
    expect(callbacks(keyboard)).toEqual([{ type: "achievements", page: 1 }, { type: "profile" }]);
  });

  test("secrets stay hidden until found", () => {
    const last = renderAchievements(i18n, "en", data, 999, catalogue);
    expect(last.text).toContain("Secret achievements found: 1 of");
    expect(last.text).toContain(entry("secret_deep_night").title.en);
    expect(last.text).not.toContain(entry("secret_word_hoard").title.en);
    // Clamped to the last page: back, no next.
    expect(callbacks(last.keyboard)[0]?.type).toBe("achievements");
    expect(callbacks(last.keyboard)).toHaveLength(2);
    const first = renderAchievements(i18n, "en", data, 0, catalogue).text;
    for (const secret of catalogue.entries.filter((one) => one.secret)) {
      expect(first).not.toContain(secret.title.en);
    }
  });

  test("a CEFR series shows bands, not numbers", () => {
    const all = everyPage({ unlocked: new Set(), counters: new Map([["skill_grammar", 1]]) });
    expect(all).toContain(`A2/A2 → ${entry("skill_grammar_1").title.en}`);
  });
});

describe("unlock notice on the hub", () => {
  test("names at most three and counts the rest", () => {
    const four = ["words_learned_1", "reviews_10", "goal_days_1", "day_streak_2"].map(entry);
    const line = unlockNotice(i18n, "en", four) ?? "";
    expect(line).toContain(entry("goal_days_1").title.en);
    expect(line).not.toContain(entry("day_streak_2").title.en);
    expect(line).toContain("and 1 more");
    expect(unlockNotice(i18n, "en", [])).toBeUndefined();
  });

  test("rides the main screen under the last session line", () => {
    const notice = unlockNotice(i18n, "ru", [entry("words_learned_1")]);
    const { text } = renderScreen(i18n, "main", {
      locale: "ru",
      dueCount: 0,
      lastSummary: "done",
      unlockNotice: notice,
    });
    expect(text.endsWith(notice ?? "-")).toBe(true);
    expect(text).toContain(entry("words_learned_1").title.ru);
  });
});

describe("learner-local clock", () => {
  test("hour, weekend and day in the learner's zone", () => {
    expect(localClock(new Date("2026-10-30T17:30:00Z"), "Asia/Tokyo")).toEqual({
      hour: 2,
      weekend: true,
      day: "10-31",
    });
    expect(localClock(new Date("2026-10-27T00:30:00Z"), "Not/AZone").hour).toBe(0);
  });

  test("seasons may wrap the new year", () => {
    const newYear = { from: "12-25", to: "01-07" };
    expect(inSeason("12-31", newYear)).toBe(true);
    expect(inSeason("01-07", newYear)).toBe(true);
    expect(inSeason("01-08", newYear)).toBe(false);
    expect(inSeason("10-31", { from: "10-31", to: "10-31" })).toBe(true);
  });
});
