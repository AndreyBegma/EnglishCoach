import { describe, expect, test } from "bun:test";
import {
  firstSentence,
  grade,
  nextStep,
  type PlacementAnswer,
  PlacementError,
  type PlacementItem,
  type PlacementOutput,
} from "../../src/onboarding/placement";

const item: PlacementItem = {
  level: "B1",
  skill: "grammar",
  topic: "first conditional",
  question: "If it rains, we ___ home.",
  options: ["stay", "stayed", "would stay", "staying"],
  correct_index: 0,
};

const answer = (n: number): PlacementAnswer => ({
  level: "B1",
  skill: "grammar",
  topic: `topic ${n}`,
  correct: true,
});
const answers = (n: number) => Array.from({ length: n }, (_, i) => answer(i));

const keepGoing: PlacementOutput = {
  status: "continue",
  estimate: { level: "B2", confidence: 0.5 },
  item,
  summary: null,
};
const final: PlacementOutput = {
  status: "final",
  estimate: { level: "B2", confidence: 0.9 },
  item: null,
  summary: "You are B2. Strong grammar. Work on idioms.",
};

describe("grade", () => {
  test("the server compares the chosen option with the correct index", () => {
    expect(grade(item, 0)).toEqual({
      level: "B1",
      skill: "grammar",
      topic: "first conditional",
      correct: true,
    });
    expect(grade(item, 2).correct).toBe(false);
  });
});

describe("nextStep", () => {
  test("continues with the skill's item", () => {
    expect(nextStep(answers(3), keepGoing)).toEqual({ kind: "item", item });
  });

  test("stops early when the skill says final", () => {
    expect(nextStep(answers(8), final)).toEqual({
      kind: "final",
      level: "B2",
      summary: final.summary,
    });
  });

  test("stops at 15 items even if the skill wants more", () => {
    expect(nextStep(answers(14), keepGoing).kind).toBe("item");
    expect(nextStep(answers(15), keepGoing)).toEqual({
      kind: "final",
      level: "B2",
      summary: null,
    });
  });

  test("refuses a verdict nobody tested for", () => {
    expect(() => nextStep([], final)).toThrow(PlacementError);
  });
});

describe("firstSentence", () => {
  test.each([
    ["You are B2. Strong grammar.", "You are B2."],
    ["Рівень B1! Далі краще.", "Рівень B1!"],
    ["No full stop", "No full stop"],
    ["  Spaces first. Then more.", "Spaces first."],
    ["Version 3.5 works. Next.", "Version 3.5 works."],
  ])("%p → %p", (text, expected) => {
    expect(firstSentence(text)).toBe(expected);
  });
});
