import { describe, expect, test } from "bun:test";
import type { CefrLevel } from "../../src/db/schema";
import type { SyllabusTopic } from "../../src/grammar/syllabus";
import { nextTopic, topicFlags } from "../../src/placement/topics";

const topic = (id: string, band: CefrLevel, step = 1): SyllabusTopic => ({
  id,
  band,
  step,
  level: `${band}.${step}`,
  title: { en: id, ru: id, uk: id },
  prerequisites: [],
  contrastWith: [],
  examples: [],
  interference: [],
  exerciseTypes: [],
});

const SYLLABUS = [
  topic("a1", "A1"),
  topic("a2", "A2"),
  topic("b1a", "B1", 1),
  topic("b1b", "B1", 2),
  topic("b1c", "B1", 3),
  topic("b2", "B2"),
  topic("c1", "C1"),
];

describe("placement topic flags", () => {
  test("bands below the grammar result are mastered, its own band unknown, above unflagged", () => {
    expect(topicFlags(SYLLABUS, "B1", [])).toEqual([
      { topicId: "a1", status: "mastered" },
      { topicId: "a2", status: "mastered" },
      { topicId: "b1a", status: "unknown" },
      { topicId: "b1b", status: "unknown" },
      { topicId: "b1c", status: "unknown" },
    ]);
  });

  test("a tested topic follows its answers, wherever it sits", () => {
    const flags = topicFlags(SYLLABUS, "B1", [
      { topicId: "a2", correct: false },
      { topicId: "b1b", correct: true },
      { topicId: "b2", correct: true },
      { topicId: "b1c", correct: true },
      { topicId: "b1c", correct: false },
    ]);
    expect(flags).toContainEqual({ topicId: "a2", status: "unknown" });
    expect(flags).toContainEqual({ topicId: "b1b", status: "mastered" });
    expect(flags).toContainEqual({ topicId: "b2", status: "mastered" });
    expect(flags).toContainEqual({ topicId: "b1c", status: "unknown" });
    expect(flags.find((flag) => flag.topicId === "c1")).toBeUndefined();
  });

  test("the next topic is an unasked one of the band, from its first half", () => {
    expect(nextTopic(SYLLABUS, "B1", [], () => 0)?.id).toBe("b1a");
    expect(nextTopic(SYLLABUS, "B1", [], (count) => count - 1)?.id).toBe("b1b");
    const asked = [
      { topicId: "b1a", correct: true },
      { topicId: "b1b", correct: false },
    ];
    expect(nextTopic(SYLLABUS, "B1", asked, () => 0)?.id).toBe("b1c");
    expect(nextTopic(SYLLABUS, "B2", [{ topicId: "b2", correct: true }])).toBeUndefined();
    expect(nextTopic(SYLLABUS, "C2", [])).toBeUndefined();
  });
});
