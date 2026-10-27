import { describe, expect, test } from "bun:test";
import { SYLLABUS } from "../../src/grammar/topics";
import { grammarItemDifficulty, parseCefr, turnScore } from "../../src/levels";

describe("grammar item difficulty", () => {
  test("a syllabus topic gives its level at step precision", () => {
    for (const topic of SYLLABUS.topics.slice(0, 20)) {
      const difficulty = grammarItemDifficulty({ topic_id: topic.id, difficulty: "C2" });
      expect(difficulty).toBe(parseCefr(topic.level) as number);
    }
  });

  test("no topic, or one the syllabus does not know, falls back to the quiz's estimate", () => {
    expect(grammarItemDifficulty({ topic_id: null, difficulty: "A2" })).toBe("A2");
    expect(grammarItemDifficulty({ topic_id: "g999", difficulty: "B2" })).toBe("B2");
  });
});

describe("talk turn score", () => {
  test("short turns are not evidence; corrections take off by severity", () => {
    expect(turnScore("ok thanks", [])).toBeNull();
    expect(turnScore("I really enjoyed the film last night", [])).toBe(1);
    expect(
      turnScore("I have went to the cinema last night", [
        { severity: "critical" },
        { severity: "minor" },
      ]),
    ).toBeCloseTo(0.4);
  });
});
