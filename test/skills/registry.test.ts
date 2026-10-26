import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASE_SKILLS,
  loadSkillRegistry,
  parseSkill,
  SkillDefinitionError,
  SkillRegistry,
  UnknownSkillError,
} from "../../src/skills";

function skillSource(overrides: Record<string, string | number> = {}, body = "Coach {{level}}.") {
  const meta = {
    id: "my-skill",
    title: "My skill",
    kind: "quiz",
    input: "GrammarQuizInput",
    output: "GrammarQuizOutput",
    model_hint: "fast",
    ...overrides,
  };
  const yaml = Object.entries(meta)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `---\n${yaml}\n---\n${body}\n`;
}

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a throw");
}

describe("parseSkill", () => {
  test("reads frontmatter and body into a definition", () => {
    const skill = parseSkill(
      skillSource({ temperature: 0.4, max_tokens: 900, model_hint: "smart" }),
      "skills/my-skill/SKILL.md",
      "my-skill",
    );
    expect(skill).toMatchObject({
      id: "my-skill",
      title: "My skill",
      kind: "quiz",
      inputName: "GrammarQuizInput",
      outputName: "GrammarQuizOutput",
      tier: "smart",
      temperature: 0.4,
      maxTokens: 900,
      body: "Coach {{level}}.",
      file: "skills/my-skill/SKILL.md",
    });
  });

  const bad: [string, string, RegExp][] = [
    ["no frontmatter", "Just a prompt", /missing YAML frontmatter/],
    ["invalid YAML", "---\nid: [unclosed\n---\nbody", /not valid YAML/],
    ["a missing field", skillSource().replace("title: My skill\n", ""), /bad frontmatter.*title/s],
    ["an unknown field", skillSource({ colour: "red" }), /bad frontmatter.*colour/s],
    ["a bad model_hint", skillSource({ model_hint: "huge" }), /bad frontmatter.*model_hint/s],
    ["a bad kind", skillSource({ kind: "essay" }), /bad frontmatter.*kind/s],
    ["temperature out of range", skillSource({ temperature: 1.5 }), /temperature/],
    ["an unknown output schema", skillSource({ output: "NoOut" }), /unknown output schema "NoOut"/],
    ["an unknown input schema", skillSource({ input: "NoIn" }), /unknown input schema "NoIn"/],
    [
      "an unknown placeholder",
      skillSource({}, "Hi {{level}} {{learner_name}}"),
      /unknown placeholder\(s\) \{\{learner_name\}\}/,
    ],
    ["an empty body", skillSource({}, "   "), /empty prompt body/],
    [
      "a base skill with the wrong schemas",
      skillSource({ id: "grammar-check" }),
      /base skill "grammar-check" must use GrammarCheckInput -> GrammarCheckOutput/,
    ],
  ];

  for (const [name, source, message] of bad) {
    test(`rejects ${name}, naming the file`, () => {
      const error = errorOf(() => parseSkill(source, "skills/x/SKILL.md"));
      expect(error).toBeInstanceOf(SkillDefinitionError);
      expect(error.message.startsWith("skills/x/SKILL.md: ")).toBe(true);
      expect(error.message).toMatch(message);
    });
  }

  test("rejects an id that does not match its directory", () => {
    expect(() => parseSkill(skillSource(), "skills/other/SKILL.md", "other")).toThrow(
      /id "my-skill" does not match its directory "other"/,
    );
  });

  test("lists every problem at once", () => {
    const error = errorOf(() =>
      parseSkill(skillSource({ output: "Nope" }, "{{oops}}"), "skills/x/SKILL.md"),
    );
    expect(error.message).toMatch(/unknown output schema.*unknown placeholder/);
  });
});

describe("SkillRegistry", () => {
  const skill = parseSkill(skillSource(), "a/SKILL.md");

  test("looks skills up by id and rejects unknown ids", () => {
    const registry = new SkillRegistry([skill]);
    expect(registry.get("my-skill")).toBe(skill);
    expect(registry.has("nope")).toBe(false);
    expect(registry.ids()).toEqual(["my-skill"]);
    expect(() => registry.get("nope")).toThrow(UnknownSkillError);
  });

  test("rejects duplicate ids", () => {
    expect(() => new SkillRegistry([skill, { ...skill, file: "b/SKILL.md" }])).toThrow(
      /b\/SKILL.md: duplicate id "my-skill" \(also a\/SKILL.md\)/,
    );
  });
});

describe("loadSkillRegistry", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function write(id: string, source: string) {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "SKILL.md"), source);
  }

  test("loads every skill directory", () => {
    dir = mkdtempSync(join(tmpdir(), "skills-"));
    write("my-skill", skillSource());
    write("second", skillSource({ id: "second" }));
    writeFileSync(join(dir, "README.md"), "not a skill");
    expect(loadSkillRegistry(dir, { required: [] }).ids()).toEqual(["my-skill", "second"]);
  });

  test("fails boot naming every bad file and every missing required skill", () => {
    dir = mkdtempSync(join(tmpdir(), "skills-"));
    write("my-skill", skillSource({ output: "Missing" }));
    write("broken", "no frontmatter");
    mkdirSync(join(dir, "empty"));

    const error = errorOf(() => loadSkillRegistry(dir, { required: ["grammar-quiz"] }));
    expect(error).toBeInstanceOf(SkillDefinitionError);
    expect(error.message).toMatch(/my-skill\/SKILL.md: unknown output schema "Missing"/);
    expect(error.message).toMatch(/broken\/SKILL.md: missing YAML frontmatter/);
    expect(error.message).toMatch(/empty\/SKILL.md: missing/);
    expect(error.message).toMatch(/required skill "grammar-quiz" is missing/);
  });

  test("the repository's skills/ directory holds every base skill and loads cleanly", () => {
    dir = mkdtempSync(join(tmpdir(), "unused-"));
    expect(loadSkillRegistry().ids()).toEqual(Object.keys(BASE_SKILLS).sort());
  });
});
