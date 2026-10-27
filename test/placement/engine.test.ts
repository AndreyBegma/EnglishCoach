import { describe, expect, test } from "bun:test";
import type { CefrLevel } from "../../src/db/schema";
import { bandOf, PRIOR, SEEDED_UNCERTAINTY } from "../../src/levels/model";
import {
  completeItem,
  currentSection,
  finalResults,
  gradeTask,
  isFinished,
  type PlacementProgress,
  RUBRIC_UNCERTAINTY,
  SECTION_ITEMS,
  SECTION_START_UNCERTAINTY,
  scoreAnswer,
  skipSection,
  startProgress,
  targetLevel,
} from "../../src/placement/engine";
import { PLACEMENT_QUESTIONS } from "../../src/skills/schemas";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** A simulated learner who answers right every item at or below `level`, wrong above it. */
function takeSection(progress: PlacementProgress, level: CefrLevel): PlacementProgress {
  const section = currentSection(progress);
  if (!section) throw new Error("no section");
  let next = progress;
  for (let item = 0; item < SECTION_ITEMS[section]; item++) {
    for (let q = 0; q < PLACEMENT_QUESTIONS[section]; q++) {
      const pitched = targetLevel(next);
      next = scoreAnswer(next, pitched, LEVELS.indexOf(pitched) <= LEVELS.indexOf(level));
    }
    next = completeItem(next, `${section} ${item}`);
  }
  return next;
}

describe("placement engine", () => {
  test("starts on grammar at the prior, pitched at B1", () => {
    const progress = startProgress();
    expect(currentSection(progress)).toBe("grammar");
    expect(progress.current).toEqual({ ...PRIOR });
    expect(targetLevel(progress)).toBe("B1");
  });

  test("a right answer pitches the next item higher, a wrong one lower", () => {
    const start = startProgress();
    expect(targetLevel(scoreAnswer(start, "B1", true))).toBe("B2");
    expect(targetLevel(scoreAnswer(start, "B1", false))).toBe("A2");
  });

  test.each(LEVELS)("a learner at %s ends grammar within half a band of it", (level) => {
    const progress = takeSection(startProgress(), level);
    const grammar = progress.results.grammar;
    if (!grammar) throw new Error("grammar not closed");
    expect(Math.abs(grammar.rating - (LEVELS.indexOf(level) + 0.5))).toBeLessThanOrEqual(0.75);
    expect(grammar.evidence).toBe(SECTION_ITEMS.grammar);
    expect(grammar.uncertainty).toBeLessThan(PRIOR.uncertainty);
    expect(grammar.skipped).toBe(false);
  });

  test("a section closes after its items; the next one starts at the level measured so far", () => {
    const progress = takeSection(startProgress(), "B2");
    expect(currentSection(progress)).toBe("vocabulary");
    expect(progress.done).toBe(0);
    expect(progress.evidence).toBe(0);
    expect(progress.current.rating).toBeCloseTo(progress.results.grammar?.rating ?? -1);
    expect(progress.current.uncertainty).toBe(SECTION_START_UNCERTAINTY);
  });

  test("reading and listening items carry two questions each", () => {
    let progress = takeSection(takeSection(startProgress(), "B1"), "B1");
    expect(currentSection(progress)).toBe("reading");
    progress = scoreAnswer(progress, targetLevel(progress), true);
    expect(progress.done).toBe(0);
    progress = scoreAnswer(progress, targetLevel(progress), true);
    progress = completeItem(progress, "a text");
    expect(progress.done).toBe(1);
    expect(currentSection(progress)).toBe("reading");
  });

  test("grammar answers name their topic for the topic flags", () => {
    const progress = scoreAnswer(startProgress(), "B1", false, "g020");
    expect(progress.topics).toEqual([{ topicId: "g020", correct: false }]);
    expect(scoreAnswer(progress, "B1", true).topics).toHaveLength(1);
  });

  test("a rubric grade sets the skill at its band with the rubric's uncertainty", () => {
    let progress = startProgress();
    for (const level of ["B1", "B1", "B1", "B1"] as const) progress = takeSection(progress, level);
    expect(currentSection(progress)).toBe("writing");
    progress = gradeTask(progress, "B2", "Good linking; watch articles.", "a trip");
    expect(progress.results.writing).toEqual({
      rating: 3.5,
      uncertainty: RUBRIC_UNCERTAINTY,
      evidence: 1,
      skipped: false,
      feedback: "Good linking; watch articles.",
    });
    expect(currentSection(progress)).toBe("speaking");
  });

  test("a skipped section starts at the measured level, unsure and without evidence", () => {
    let progress = startProgress();
    for (const level of ["C1", "C1", "C1"] as const) progress = takeSection(progress, level);
    expect(currentSection(progress)).toBe("listening");
    progress = skipSection(progress);
    const listening = progress.results.listening;
    expect(listening).toMatchObject({
      evidence: 0,
      skipped: true,
      uncertainty: SEEDED_UNCERTAINTY.chosen,
    });
    expect(bandOf(listening?.rating ?? 0)).toBe("C1");
    expect(currentSection(progress)).toBe("writing");
  });

  test("the results are complete only after the last section", () => {
    let progress = startProgress();
    for (const level of ["A2", "A2", "A2", "A2"] as const) progress = takeSection(progress, level);
    progress = gradeTask(progress, "A2", "ok", "writing");
    expect(finalResults(progress)).toBeUndefined();
    progress = skipSection(progress);
    expect(isFinished(progress)).toBe(true);
    const results = finalResults(progress);
    expect(Object.keys(results ?? {})).toEqual([
      "grammar",
      "vocabulary",
      "reading",
      "listening",
      "writing",
      "speaking",
    ]);
    expect(results?.speaking.skipped).toBe(true);
  });

  test("used subjects are remembered without duplicates, the latest twenty", () => {
    let progress = startProgress();
    for (let n = 0; n < 25; n++) progress = { ...completeItem(progress, `s${n % 22}`), section: 0 };
    expect(progress.used).toHaveLength(20);
    expect(new Set(progress.used).size).toBe(20);
    expect(progress.used.at(-1)).toBe("s2");
  });
});
