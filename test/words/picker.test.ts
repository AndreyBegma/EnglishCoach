import { describe, expect, test } from "bun:test";
import { cefrLevelEnum } from "../../src/db/schema";
import { nextUnitType, offersType, planTypes, unitLevels } from "../../src/words/picker";

const all = () => true;

describe("unit mix by level", () => {
  test("idioms are offered from B2 only", () => {
    expect(cefrLevelEnum.enumValues.filter((level) => offersType(level, "idiom"))).toEqual([
      "B2",
      "C1",
      "C2",
    ]);
    expect(offersType("A1", "phrasal_verb")).toBe(false);
    expect(offersType("A1", "collocation")).toBe(true);
  });

  test("idioms are never searched below B2, even for a C2 learner going down", () => {
    expect(unitLevels("B1", "idiom")).toEqual(["B2"]);
    expect(unitLevels("C2", "idiom")).toEqual(["C2", "C1", "B2"]);
    expect(unitLevels("B1", "phrasal_verb")).toEqual(["B1", "B2", "A2", "A1"]);
  });

  test("a B1 learner never gets an idiom, whatever is available", () => {
    expect(nextUnitType("B1", { word: 50 }, (type) => type === "idiom")).toBeUndefined();
    const plan = planTypes("B1", 40, {}, { word: 40, idiom: 40, collocation: 40 });
    expect(plan).not.toContain("idiom");
  });

  test("the next type is the largest deficit; words lead a fresh learner", () => {
    expect(nextUnitType("B1", {}, all)).toBe("word");
    // 2 words, nothing else: collocation and phrasal verb tie at 0.45, collocation comes first.
    expect(nextUnitType("B1", { word: 2 }, all)).toBe("collocation");
  });

  test("twenty B2 picks follow the shares", () => {
    const plan = planTypes(
      "B2",
      20,
      {},
      {
        word: 20,
        collocation: 20,
        phrasal_verb: 20,
        word_family: 20,
        idiom: 20,
      },
    );
    const tally = (type: string) => plan.filter((t) => t === type).length;
    expect(plan).toHaveLength(20);
    expect([tally("word"), tally("collocation"), tally("phrasal_verb")]).toEqual([10, 3, 3]);
    expect([tally("word_family"), tally("idiom")]).toEqual([2, 2]);
  });

  test("a type that runs dry leaves its slots to the others", () => {
    expect(planTypes("B1", 5, {}, { word: 5 })).toEqual(["word", "word", "word", "word", "word"]);
    expect(planTypes("B1", 5, {}, { word: 1, collocation: 1 })).toEqual(["word", "collocation"]);
  });
});
