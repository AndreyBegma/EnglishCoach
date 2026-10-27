import { describe, expect, test } from "bun:test";
import { SUPPORTED_LOCALES } from "../../src/bot/i18n";
import {
  type Achievement,
  buildCatalogue,
  loadCatalogue,
  TIERS,
} from "../../src/gamification/achievements/catalogue";
import { METRICS } from "../../src/gamification/achievements/metrics";
import { SYLLABUS } from "../../src/grammar/topics";

const catalogue = loadCatalogue();

const title = (en: string) => ({ en, ru: en, uk: en });

describe("the achievements catalogue", () => {
  test("holds at least 500 entries", () => {
    expect(catalogue.entries.length).toBeGreaterThanOrEqual(500);
  });

  test("every id is unique", () => {
    const ids = catalogue.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every title and description is in every locale", () => {
    for (const entry of catalogue.entries) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(entry.title[locale]?.trim()).toBeTruthy();
        expect(entry.description[locale]?.trim()).toBeTruthy();
        expect(entry.title[locale]).not.toContain("{n}");
        expect(entry.description[locale]).not.toContain("{n}");
      }
    }
  });

  test("every metric is a known one", () => {
    for (const entry of catalogue.entries) expect(METRICS.has(entry.metric)).toBe(true);
  });

  test("per metric, a higher tier never asks for less", () => {
    const byCounter = Map.groupBy(catalogue.entries, (entry) => entry.counter);
    for (const [counter, entries] of byCounter) {
      const sorted = [...entries].sort((a, b) => a.threshold - b.threshold);
      for (let i = 1; i < sorted.length; i++) {
        const [before, after] = [sorted[i - 1] as Achievement, sorted[i] as Achievement];
        // Secret extras sit above their series; within a series the tier only goes up.
        if (before.series !== after.series) continue;
        expect(`${counter}:${after.threshold}`).not.toBe(`${counter}:${before.threshold}`);
        expect(TIERS.indexOf(after.tier)).toBeGreaterThanOrEqual(TIERS.indexOf(before.tier));
      }
    }
  });

  test("every syllabus topic has its achievement", () => {
    for (const topic of SYLLABUS.topics) {
      const entry = catalogue.byId.get(`topic_${topic.id}`);
      expect(entry?.counter).toBe(`topic_mastered.${topic.id}`);
      expect(entry?.title.en).toContain(topic.title.en);
    }
  });

  test("XP rewards are positive whole numbers", () => {
    for (const entry of catalogue.entries) {
      expect(Number.isInteger(entry.xpReward) && entry.xpReward > 0).toBe(true);
    }
  });

  test("a series expands into one entry per step with its threshold in the title", () => {
    const built = buildCatalogue(
      [
        {
          name: "x.yaml",
          data: {
            series: [
              {
                id: "words_learned",
                category: "words",
                metric: "words_learned",
                emoji: "📚",
                title: title("Words: {n}"),
                description: title("Learn {n}"),
                steps: { bronze: [1, 10], gold: [100] },
              },
            ],
          },
        },
      ],
      [],
    );
    expect(built.entries.map((entry) => [entry.id, entry.tier, entry.title.en])).toEqual([
      ["words_learned_1", "bronze", "Words: 1"],
      ["words_learned_10", "bronze", "Words: 10"],
      ["words_learned_100", "gold", "Words: 100"],
    ]);
    expect(built.entries[2]?.xpReward).toBe(50);
  });

  test("a CEFR series shows its thresholds as bands", () => {
    const built = buildCatalogue(
      [
        {
          name: "x.yaml",
          data: {
            series: [
              {
                id: "skill_grammar",
                category: "levels",
                metric: "skill_grammar",
                format: "cefr",
                emoji: "📐",
                title: title("Grammar at {n}"),
                description: title("Reach {n}"),
                steps: { bronze: [1], silver: [2] },
              },
            ],
          },
        },
      ],
      [],
    );
    expect(built.entries.map((entry) => entry.title.en)).toEqual([
      "Grammar at A2",
      "Grammar at B1",
    ]);
  });

  test("rejects falling thresholds, unknown metrics, missing locales and duplicate ids", () => {
    const series = (overrides: Record<string, unknown>) => ({
      id: "s",
      category: "words",
      metric: "words_learned",
      emoji: "📚",
      title: title("{n}"),
      description: title("{n}"),
      steps: { bronze: [10] },
      ...overrides,
    });
    const build = (data: unknown) => () => buildCatalogue([{ name: "x.yaml", data }], []);
    expect(build({ series: [series({ steps: { bronze: [10], silver: [5] } })] })).toThrow(
      /does not rise/,
    );
    expect(build({ series: [series({ metric: "nope" })] })).toThrow(/unknown metric/);
    expect(build({ series: [series({ title: { en: "x", ru: "x" } })] })).toThrow(/x\.yaml/);
    expect(build({ series: [series({}), series({})] })).toThrow(/duplicate/);
  });
});
