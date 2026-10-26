import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { toJsonSchema } from "../../src/llm/structured";
import type { CompletionRequest, LlmProvider } from "../../src/llm/types";
import {
  BASE_SKILLS,
  type BaseSkillId,
  type LearnerContext,
  loadSkillRegistry,
  SkillRunner,
} from "../../src/skills";

// Learner-written text in every channel the engine reads from; none of it may reach `system`.
const SENTINEL = "SENTINEL-LEARNER-TEXT";

const learner: LearnerContext = {
  level: "B1",
  explainLang: "ru",
  uiLang: "ru",
  nativeLang: "ru",
  interests: [`football ${SENTINEL}`],
  weakSpots: [
    {
      category: "grammar",
      pattern: `present perfect with since ${SENTINEL}`,
      exampleWrong: `I live here since 2020 ${SENTINEL}`,
      exampleRight: "I have lived here since 2020",
      timesSeen: 3,
    },
  ],
};

const registry = loadSkillRegistry();
const fixtures = join(import.meta.dir, "../fixtures/skills");

async function fixture(id: string, name: "vars" | "output"): Promise<Record<string, unknown>> {
  return Bun.file(join(fixtures, id, `${name}.json`)).json();
}

/** Plays back the recorded output and keeps the request it was asked with. */
function playback(output: unknown) {
  const requests: CompletionRequest<unknown>[] = [];
  const provider: LlmProvider = {
    kind: "server",
    async complete<T>(req: CompletionRequest<T>) {
      requests.push(req as CompletionRequest<unknown>);
      return { data: req.schema.parse(output) };
    },
  };
  return { provider, requests };
}

describe.each(Object.keys(BASE_SKILLS) as BaseSkillId[])("skill %s", (id) => {
  const skill = registry.get(id);

  test("its output schema is a root object the providers can send", () => {
    expect(toJsonSchema(skill.output)).toMatchObject({ type: "object" });
  });

  test("renders with every placeholder filled and no learner text in the system prompt", async () => {
    const vars = await fixture(id, "vars");
    const { provider, requests } = playback(await fixture(id, "output"));
    const runner = new SkillRunner({
      registry,
      provider: async () => provider,
      learner: async () => learner,
    });

    await runner.runSkill(1, id, { ...vars, ...sentinelVars(skill.input.shape) });

    const req = requests[0];
    expect(req?.system).not.toMatch(/\{\{|\}\}/);
    expect(req?.system).not.toContain(SENTINEL);
    expect(req?.system).toContain(skill.body.split("\n")[0] ?? "");
    expect(req?.messages.at(-1)?.content).toContain(SENTINEL);
    expect(req?.tier).toBe(skill.tier);
  });

  test("the recorded output passes the schema", async () => {
    const result = skill.output.safeParse(await fixture(id, "output"));
    expect(result.error).toBeUndefined();
  });

  test("the recorded vars pass the input schema", async () => {
    const result = skill.input.safeParse(await fixture(id, "vars"));
    expect(result.error).toBeUndefined();
  });
});

/** Puts the sentinel into the skill's free-text vars, where learner text actually arrives. */
function sentinelVars(shape: Record<string, unknown>): Record<string, string> {
  const learnerFields = ["learner_message", "learner_answer", "lemma"];
  return Object.fromEntries(
    learnerFields.filter((key) => key in shape).map((key) => [key, `x ${SENTINEL}`]),
  );
}

describe("output rules the JSON Schema cannot express", () => {
  const parse = (id: BaseSkillId, value: unknown) =>
    registry.get(id).output.safeParse(value).success;

  test("grammar-quiz: choice items need 4 distinct options and a consistent answer", async () => {
    const quiz = await fixture("grammar-quiz", "output");
    expect(parse("grammar-quiz", quiz)).toBe(true);
    expect(parse("grammar-quiz", { ...quiz, options: ["a", "b", "c"] })).toBe(false);
    expect(parse("grammar-quiz", { ...quiz, options: ["a", "A", "b", "c"] })).toBe(false);
    expect(parse("grammar-quiz", { ...quiz, correct_index: 4 })).toBe(false);
    expect(parse("grammar-quiz", { ...quiz, accepted_answers: ["lived"] })).toBe(false);
  });

  test("grammar-quiz: non-choice items carry no options and gap fills need a gap", async () => {
    const quiz = await fixture("grammar-quiz", "output");
    const gap = { ...quiz, type: "gap_fill", options: null, correct_index: null };
    expect(parse("grammar-quiz", gap)).toBe(true);
    expect(parse("grammar-quiz", { ...gap, question: "No gap here." })).toBe(false);
    expect(parse("grammar-quiz", { ...gap, options: ["a", "b", "c", "d"] })).toBe(false);
  });

  test("grammar-check: severity, category and pattern exist exactly when not correct", async () => {
    const check = await fixture("grammar-check", "output");
    expect(parse("grammar-check", { ...check, severity: null })).toBe(false);
    const correct = { ...check, verdict: "correct", severity: null, category: null, pattern: null };
    expect(parse("grammar-check", correct)).toBe(true);
    expect(parse("grammar-check", { ...correct, category: "grammar" })).toBe(false);
  });

  test("vocab-exercise: cloze needs a gap and recognition needs options", async () => {
    const exercise = await fixture("vocab-exercise", "output");
    expect(parse("vocab-exercise", { ...exercise, options: null })).toBe(false);
    const cloze = { ...exercise, mode: "cloze", options: null, correct_index: null };
    expect(parse("vocab-exercise", { ...cloze, prompt: "I need to ___ some money." })).toBe(true);
    expect(parse("vocab-exercise", cloze)).toBe(false);
  });

  test("vocab-check: a wrong answer is always rated again and matched as nothing", async () => {
    const check = await fixture("vocab-check", "output");
    const wrong = { ...check, verdict: "wrong", accepted_as: null, suggested_rating: "again" };
    expect(parse("vocab-check", wrong)).toBe(true);
    expect(parse("vocab-check", { ...wrong, suggested_rating: "hard" })).toBe(false);
    expect(parse("vocab-check", { ...wrong, accepted_as: "typo" })).toBe(false);
    expect(parse("vocab-check", { ...check, accepted_as: null })).toBe(false);
  });

  test("placement-test: continue carries an item, final carries a summary", async () => {
    const next = await fixture("placement-test", "output");
    expect(parse("placement-test", { ...next, item: null })).toBe(false);
    const final = { ...next, status: "final", item: null, summary: "Уровень B1." };
    expect(parse("placement-test", final)).toBe(true);
    expect(parse("placement-test", { ...final, summary: null })).toBe(false);
  });

  test("conversation: at most 5 corrections", async () => {
    const turn = await fixture("conversation", "output");
    const corrections = turn.corrections as unknown[];
    const six = [...corrections, ...corrections].slice(0, 6);
    expect(six).toHaveLength(6);
    expect(parse("conversation", { ...turn, corrections: six })).toBe(false);
    expect(parse("conversation", { ...turn, corrections: [] })).toBe(true);
  });
});
