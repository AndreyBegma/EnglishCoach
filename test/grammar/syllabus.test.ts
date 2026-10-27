import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSyllabus, loadSyllabus } from "../../src/grammar/syllabus";
import { CEFR_LEVELS } from "../../src/settings/options";

const topic = (level: string, prerequisites: string[] = [], extra: object = {}) => ({
  level,
  title: { en: "Title", ru: "Заголовок", uk: "Заголовок" },
  prerequisites,
  examples: ["One example.", "Another example."],
  interference: [{ wrong: "I developer.", right: "I am a developer.", cause: "No copula." }],
  exercise_types: ["gap_fill"],
  ...extra,
});

const build = (data: unknown) => () => buildSyllabus([{ name: "test.yaml", data }]);

describe("syllabus validation", () => {
  test("a valid map builds, ordered by level", () => {
    const syllabus = buildSyllabus([
      { name: "b.yaml", data: { g002: topic("A2.3", ["g001"]) } },
      { name: "a.yaml", data: { g001: topic("A1.1") } },
    ]);
    expect(syllabus.topics.map((t) => t.id)).toEqual(["g001", "g002"]);
    expect(syllabus.byId.get("g002")).toMatchObject({ band: "A2", step: 3, level: "A2.3" });
  });

  test("a prerequisite cycle is rejected", () => {
    expect(
      build({
        g001: topic("B1.1", ["g003"]),
        g002: topic("B1.1", ["g001"]),
        g003: topic("B1.1", ["g002"]),
      }),
    ).toThrow(/prerequisite cycle: g001 → g003 → g002 → g001/);
  });

  test("a topic cannot be its own prerequisite", () => {
    expect(build({ g001: topic("A1.1", ["g001"]) })).toThrow(/prerequisite g001 is the topic/);
  });

  test("an unknown prerequisite or contrast is rejected", () => {
    expect(build({ g001: topic("A1.1", ["g999"]) })).toThrow(/g001: unknown prerequisite g999/);
    expect(build({ g001: topic("A1.1", [], { contrast_with: ["g998"] }) })).toThrow(
      /g001: unknown contrast g998/,
    );
  });

  test("a prerequisite above its topic's level is rejected", () => {
    expect(build({ g001: topic("B1.2", ["g002"]), g002: topic("B1.5") })).toThrow(
      /prerequisite g002 \(B1.5\) is above B1.2/,
    );
  });

  test("a missing title locale is rejected", () => {
    const noUk = topic("A1.1", [], { title: { en: "Title", ru: "Заголовок" } });
    expect(build({ g001: noUk })).toThrow(/title\.uk/);
  });

  test("an id defined in two files is rejected", () => {
    expect(() =>
      buildSyllabus([
        { name: "a.yaml", data: { g001: topic("A1.1") } },
        { name: "b.yaml", data: { g001: topic("A1.2") } },
      ]),
    ).toThrow(/b.yaml: g001 is defined twice/);
  });

  test("malformed ids, levels and item types are rejected", () => {
    expect(build({ G1: topic("A1.1") })).toThrow();
    expect(build({ g001: topic("B3.1") })).toThrow(/level/);
    expect(build({ g001: topic("A1.0") })).toThrow(/level/);
    expect(build({ g001: topic("A1.1", [], { exercise_types: ["essay"] }) })).toThrow();
  });

  test("C2 topics are accepted", () => {
    expect(build({ g085: topic("C2.9") })).not.toThrow();
  });
});

describe("the syllabus files", () => {
  const syllabus = loadSyllabus();
  const seedDir = join(import.meta.dir, "..", "..", "seed", "grammar");
  const seed = readdirSync(seedDir)
    .filter((name) => /^g\d{3}\.json$/.test(name))
    .map(
      (name) => JSON.parse(readFileSync(join(seedDir, name), "utf8")) as Record<string, unknown>,
    );

  test("every topic of the owner's course is in the syllabus, at the course's band", () => {
    expect(seed.length).toBeGreaterThanOrEqual(85);
    for (const course of seed) {
      const entry = syllabus.byId.get(String(course.id));
      expect(entry, String(course.id)).toBeDefined();
      expect(entry?.band, String(course.id)).toBe(course.cefrLevel as never);
      expect(entry?.title.ru, String(course.id)).toBe(course.title as never);
    }
  });

  test("every C2 topic has at least one C1 prerequisite", () => {
    const c2 = syllabus.topics.filter((t) => t.band === "C2");
    expect(c2.length).toBeGreaterThan(0);
    for (const t of c2) {
      const hasC1 = t.prerequisites.some((id) => syllabus.byId.get(id)?.band === "C1");
      expect(hasC1, t.id).toBe(true);
    }
  });

  test("every band from A1 to C2 has topics", () => {
    for (const band of CEFR_LEVELS) {
      expect(
        syllabus.topics.some((t) => t.band === band),
        band,
      ).toBe(true);
    }
  });
});
