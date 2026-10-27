import { describe, expect, test } from "bun:test";
import type { CardBack, CardRow } from "../../src/db/schema";
import type { SkillOutput } from "../../src/skills";
import {
  ExerciseCheckError,
  effectiveMode,
  exerciseVars,
  settleExercise,
  targetForm,
} from "../../src/vocab/exercise";
import { requiredEvidence } from "../../src/vocab/mastery";
import { modeFor } from "../../src/vocab/modes";

const ALL_EVIDENCE = requiredEvidence({ earWaived: false });

type Card = Pick<CardRow, "front" | "backJson" | "reps" | "itemType">;

const card = (
  itemType: CardRow["itemType"],
  front: string,
  backJson: CardBack,
  reps = 0,
): Card => ({
  itemType,
  front,
  backJson,
  reps,
});
const giveUp = card("phrasal_verb", "give up", {
  unit: { kind: "phrasal_verb", verb: "give", particle: "up" },
});
const decision = card("collocation", "make a decision", {
  unit: { kind: "collocation", partner: "make" },
});
const decide = (reps: number) =>
  card(
    "word_family",
    "decide",
    {
      unit: {
        kind: "word_family",
        forms: [
          { pos: "verb", form: "decide" },
          { pos: "noun", form: "decision" },
          { pos: "adjective", form: "decisive" },
        ],
      },
    },
    reps,
  );
const extra = { recent_accuracy: null, distractors: [] };

describe("modeFor by item type", () => {
  // Every kind of evidence held: the rotation by memory strength alone.
  const at = (itemType: CardRow["itemType"], stability: number) =>
    modeFor({ itemType, stability, reps: 2, evidence: ALL_EVIDENCE });

  test("phrasal verbs: meaning, then particle, then an own sentence", () => {
    expect([1, 5, 12].map((s) => at("phrasal_verb", s))).toEqual([
      "recognition",
      "particle",
      "own_sentence",
    ]);
  });

  test("collocations fill the partner, word families transform, idioms rotate like words", () => {
    expect([1, 5, 12].map((s) => at("collocation", s))).toEqual([
      "recognition",
      "partner",
      "partner",
    ]);
    expect([1, 5, 12].map((s) => at("word_family", s))).toEqual([
      "recognition",
      "transform",
      "transform",
    ]);
    expect([1, 5, 12].map((s) => at("idiom", s))).toEqual(["recognition", "production", "cloze"]);
  });
});

describe("exercise vars and the server's checks", () => {
  test("the unit's facts travel to the skill", () => {
    expect(exerciseVars(giveUp, "particle", extra)).toMatchObject({
      item_type: "phrasal_verb",
      verb: "give",
      particle: "up",
      partner: null,
    });
    expect(exerciseVars(decision, "partner", extra)).toMatchObject({ partner: "make" });
    expect(exerciseVars(decide(0), "transform", extra).target_form).toEqual({
      pos: "noun",
      form: "decision",
    });
    expect(exerciseVars(card("user_word", "own", {}), "cloze", extra).item_type).toBe("word");
  });

  test("transform walks through the forms other than the lemma, one per review", () => {
    expect([0, 1, 2].map((reps) => targetForm(decide(reps))?.form)).toEqual([
      "decision",
      "decisive",
      "decision",
    ]);
  });

  test("a unit mode without the unit's data falls back to a word mode", () => {
    const bare = card("phrasal_verb", "give up", {});
    expect(effectiveMode(bare, "particle")).toBe("production");
    expect(effectiveMode(bare, "partner")).toBe("cloze");
    expect(effectiveMode(giveUp, "particle")).toBe("particle");
  });

  const particleItem = (options: string[], correct: number): SkillOutput<"vocab-exercise"> => ({
    mode: "particle",
    instruction: "Pick.",
    prompt: "Don't give ___.",
    options,
    correct_index: correct,
    accepted_answers: [options[correct] ?? ""],
  });

  test("particle: the right option is the verb's particle, re-pointed when the model erred", () => {
    const vars = exerciseVars(giveUp, "particle", extra);
    const settled = settleExercise(vars, particleItem(["in", "Up", "off", "away"], 0));
    expect(settled.correct_index).toBe(1);
    expect(settled.accepted_answers).toEqual(["Up"]);
    expect(() => settleExercise(vars, particleItem(["in", "on", "off", "away"], 0))).toThrow(
      ExerciseCheckError,
    );
  });

  test("a mode the server did not ask for is refused", () => {
    const vars = exerciseVars(giveUp, "own_sentence", extra);
    expect(() => settleExercise(vars, particleItem(["up", "in", "off", "away"], 0))).toThrow(
      "asked for own_sentence, got particle",
    );
  });

  test("partner and transform gaps always accept the server's word", () => {
    const typed = { options: null, correct_index: null, instruction: "Fill.", prompt: "___ x" };
    const partner = settleExercise(exerciseVars(decision, "partner", extra), {
      ...typed,
      mode: "partner",
      accepted_answers: ["take"],
    });
    expect(partner.accepted_answers).toEqual(["make", "take"]);
    const transform = settleExercise(exerciseVars(decide(0), "transform", extra), {
      ...typed,
      mode: "transform",
      accepted_answers: ["decision", "decisions"],
    });
    expect(transform.accepted_answers).toEqual(["decision", "decisions"]);
  });
});
