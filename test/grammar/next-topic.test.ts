import { describe, expect, test } from "bun:test";
import type { CefrLevel, TopicStatus } from "../../src/db/schema";
import { nextTopic, type TopicStanding } from "../../src/grammar/next-topic";
import type { SyllabusTopic } from "../../src/grammar/syllabus";
import { SYLLABUS } from "../../src/grammar/topics";

const NOW = new Date("2026-10-27T10:00:00Z");
const HOUR = 60 * 60 * 1000;

function topic(id: string, band: CefrLevel, step: number, prerequisites: string[] = []) {
  return {
    id,
    band,
    step,
    level: `${band}.${step}`,
    title: { en: id, ru: id, uk: id },
    prerequisites,
    contrastWith: [],
    examples: ["a", "b"],
    interference: [],
    exerciseTypes: ["multiple_choice", "gap_fill"],
  } satisfies SyllabusTopic;
}

/** A seeded syllabus in syllabus order: two A2 topics, four B1 topics with prerequisites. */
const TOPICS = [
  topic("g001", "A2", 2),
  topic("g002", "A2", 5),
  topic("g003", "B1", 1, ["g001"]),
  topic("g004", "B1", 3, ["g003"]),
  topic("g005", "B1", 5, ["g002"]),
  topic("g006", "B1", 7, ["g004", "g005"]),
];

const standing = (status: TopicStatus, reviewDue: Date | null = null): TopicStanding => ({
  status,
  reviewDue,
});
const map = (entries: Record<string, TopicStanding>) => new Map(Object.entries(entries));
const pick = (progress: Map<string, TopicStanding>, band: CefrLevel = "B1") => {
  const next = nextTopic(TOPICS, progress, band, NOW);
  return next && { id: next.topic.id, reason: next.reason };
};

describe("next-topic selector", () => {
  test("a fresh learner starts at the first topic of their band: lower-band prerequisites count", () => {
    expect(pick(map({}))).toEqual({ id: "g003", reason: "new" });
    expect(pick(map({}), "A2")).toEqual({ id: "g001", reason: "new" });
  });

  test("due reviews come first, most overdue first, from any band", () => {
    const progress = map({
      g004: standing("mastered", new Date(NOW.getTime() - HOUR)),
      g001: standing("mastered", new Date(NOW.getTime() - 5 * HOUR)),
      g005: standing("shaky"),
    });
    expect(pick(progress)).toEqual({ id: "g001", reason: "review" });
  });

  test("a mastered topic not yet due is not a review", () => {
    const progress = map({ g003: standing("mastered", new Date(NOW.getTime() + HOUR)) });
    expect(pick(progress)).toEqual({ id: "g004", reason: "new" });
  });

  test("shaky topics come before new ones, in syllabus order", () => {
    const progress = map({ g005: standing("shaky"), g002: standing("shaky") });
    expect(pick(progress)).toEqual({ id: "g002", reason: "shaky" });
  });

  test("a same-band prerequisite must be mastered first", () => {
    // g003 learning: g004 (needs g003) waits; g005 (needs A2 g002) is open.
    expect(pick(map({ g003: standing("learning") }))).toEqual({ id: "g005", reason: "new" });
    // g006 needs both g004 and g005 mastered.
    const most = map({
      g003: standing("mastered", new Date(NOW.getTime() + HOUR)),
      g004: standing("mastered", new Date(NOW.getTime() + HOUR)),
      g005: standing("learning"),
    });
    expect(pick(most)).toEqual({ id: "g005", reason: "learning" });
  });

  test("new topics are offered at the learner's band only", () => {
    const allB1Started = map({
      g003: standing("mastered", new Date(NOW.getTime() + HOUR)),
      g004: standing("mastered", new Date(NOW.getTime() + HOUR)),
      g005: standing("mastered", new Date(NOW.getTime() + HOUR)),
      g006: standing("mastered", new Date(NOW.getTime() + HOUR)),
    });
    // A2 is not started, but a B1 learner is not sent back to it.
    expect(pick(allB1Started)).toBeUndefined();
  });

  test("with nothing new, a topic still being learned is offered", () => {
    const progress = map({
      g003: standing("learning"),
      g004: standing("not_started"),
      g005: standing("learning"),
    });
    expect(pick(progress)).toEqual({ id: "g003", reason: "learning" });
  });

  test("the real syllabus always has a first topic for every band", () => {
    for (const band of ["A1", "A2", "B1", "B2", "C1", "C2"] as const) {
      const next = nextTopic(SYLLABUS.topics, new Map(), band, NOW);
      expect(next?.reason).toBe("new");
      expect(next?.topic.band).toBe(band);
    }
  });
});
