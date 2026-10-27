import { describe, expect, test } from "bun:test";
import {
  BASE_XP,
  DAILY_GOAL_XP,
  difficultyMultiplier,
  itemXp,
  LEVEL_BASE_XP,
  MASTERY_CORRECT,
  MAX_MULTIPLIER,
  profileLevel,
  STREAK_XP_CAP,
  streakXp,
  topicJustMastered,
  xpToNext,
} from "../../src/gamification/xp";
import { bandCentre } from "../../src/levels";

const B1 = bandCentre("B1");

describe("difficulty multiplier", () => {
  test("an item at the learner's level counts in full", () => {
    expect(difficultyMultiplier(B1, B1)).toBe(1);
    expect(difficultyMultiplier(B1 - 0.5, B1)).toBe(1);
  });

  test("an item above the learner earns more, up to the cap a band above", () => {
    expect(difficultyMultiplier(B1 + 0.5, B1)).toBeCloseTo(1.25);
    expect(difficultyMultiplier(B1 + 1, B1)).toBe(MAX_MULTIPLIER);
    expect(difficultyMultiplier(B1 + 3, B1)).toBe(MAX_MULTIPLIER);
  });

  test("below the at-level window it halves every half band", () => {
    expect(difficultyMultiplier(B1 - 1, B1)).toBeCloseTo(0.5);
    expect(difficultyMultiplier(B1 - 1.5, B1)).toBeCloseTo(0.25);
    expect(difficultyMultiplier(B1 - 2.5, B1)).toBeCloseTo(0.0625);
  });

  test("never rises as the item gets easier", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let gap = 2; gap >= -5; gap -= 0.1) {
      const multiplier = difficultyMultiplier(B1 + gap, B1);
      expect(multiplier).toBeLessThanOrEqual(previous);
      previous = multiplier;
    }
  });
});

describe("item XP", () => {
  test("base × score at the learner's level", () => {
    expect(itemXp("grammar_item", 1, B1, B1)).toBe(BASE_XP.grammar_item);
    expect(itemXp("grammar_item", 0.5, B1, B1)).toBe(BASE_XP.grammar_item / 2);
    expect(itemXp("grammar_item", 0, B1, B1)).toBe(0);
    expect(itemXp("talk_turn", 1, B1, B1)).toBe(BASE_XP.talk_turn);
  });

  test("a harder item is worth more", () => {
    expect(itemXp("grammar_item", 1, bandCentre("B2"), B1)).toBe(15);
    expect(itemXp("review", 1, bandCentre("C1"), B1)).toBe(6);
  });

  test("anti-farming: items far below the learner's level earn nothing", () => {
    const c1 = bandCentre("C1");
    expect(itemXp("grammar_item", 1, bandCentre("A1"), c1)).toBe(0);
    expect(itemXp("word_learned", 1, bandCentre("A2"), c1)).toBe(0);
    expect(itemXp("review", 1, bandCentre("B1"), c1)).toBe(0);
    // A band below is still worth something, at a discount.
    expect(itemXp("grammar_item", 1, bandCentre("B2"), c1)).toBe(5);
  });

  test("a score outside 0..1 is clamped", () => {
    expect(itemXp("grammar_item", 2, B1, B1)).toBe(BASE_XP.grammar_item);
    expect(itemXp("grammar_item", -1, B1, B1)).toBe(0);
  });
});

describe("goal, streak and mastery", () => {
  test("the daily goal is a fixed bonus", () => {
    expect(DAILY_GOAL_XP).toBeGreaterThan(0);
  });

  test("the streak bonus starts on day 2, grows by day, and is capped", () => {
    expect(streakXp(0)).toBe(0);
    expect(streakXp(1)).toBe(0);
    expect(streakXp(2)).toBe(10);
    expect(streakXp(5)).toBe(25);
    expect(streakXp(100)).toBe(STREAK_XP_CAP);
  });

  test("a topic is mastered exactly on the threshold answer, so only once", () => {
    expect(topicJustMastered(MASTERY_CORRECT - 1)).toBe(false);
    expect(topicJustMastered(MASTERY_CORRECT)).toBe(true);
    expect(topicJustMastered(MASTERY_CORRECT + 1)).toBe(false);
  });
});

describe("level curve", () => {
  test("each level costs 1.15× the previous one", () => {
    expect(xpToNext(1)).toBe(LEVEL_BASE_XP);
    expect(xpToNext(2)).toBe(115);
    expect(xpToNext(3)).toBe(132);
    expect(xpToNext(10)).toBe(Math.round(100 * 1.15 ** 9));
  });

  test("a total maps to a level and the XP inside it", () => {
    expect(profileLevel(0)).toEqual({ level: 1, into: 0, needed: 100 });
    expect(profileLevel(99)).toEqual({ level: 1, into: 99, needed: 100 });
    expect(profileLevel(100)).toEqual({ level: 2, into: 0, needed: 115 });
    expect(profileLevel(100 + 115 + 10)).toEqual({ level: 3, into: 10, needed: 132 });
    expect(profileLevel(-5)).toEqual({ level: 1, into: 0, needed: 100 });
  });

  test("the level never drops as XP grows", () => {
    let previous = 1;
    for (let total = 0; total < 20_000; total += 37) {
      const { level, into, needed } = profileLevel(total);
      expect(level).toBeGreaterThanOrEqual(previous);
      expect(into).toBeLessThan(needed);
      previous = level;
    }
  });
});
