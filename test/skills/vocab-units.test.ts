import { describe, expect, test } from "bun:test";
import { VocabCheckInput, VocabExerciseInput, VocabExerciseOutput } from "../../src/skills";

const typed = { options: null, correct_index: null };

/** One valid exercise per mode a lexical unit uses. */
const valid = {
  particle: {
    mode: "particle",
    instruction: "Pick the particle.",
    prompt: "Don't give ___ now. (не сдавайся)",
    options: ["up", "in", "off", "away"],
    correct_index: 0,
    accepted_answers: ["up"],
  },
  partner: {
    mode: "partner",
    instruction: "Fill in the word.",
    prompt: "We have to ___ a decision today. (принять решение)",
    ...typed,
    accepted_answers: ["make"],
  },
  transform: {
    mode: "transform",
    instruction: "Change the word.",
    prompt: "It was a hard ___. (DECIDE)",
    ...typed,
    accepted_answers: ["decision"],
  },
  own_sentence: {
    mode: "own_sentence",
    instruction: "Write a sentence.",
    prompt: "Use “give up” in a sentence about a habit you quit.",
    ...typed,
    accepted_answers: ["give up"],
  },
} as const;

describe("VocabExerciseOutput for lexical units", () => {
  test.each(Object.entries(valid))("%s: a well-formed item parses", (_, item) => {
    expect(VocabExerciseOutput.safeParse(item).success).toBe(true);
  });

  test("particle: four options, the right one among the accepted answers", () => {
    const issues = (item: object) =>
      VocabExerciseOutput.safeParse(item).error?.issues.map((issue) => issue.path.join("."));
    expect(issues({ ...valid.particle, options: null, correct_index: null })).toEqual(["options"]);
    expect(issues({ ...valid.particle, accepted_answers: ["in"] })).toEqual(["accepted_answers"]);
  });

  test("partner and transform: the gap is required", () => {
    for (const item of [valid.partner, valid.transform]) {
      const parsed = VocabExerciseOutput.safeParse({ ...item, prompt: "No gap here." });
      expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
        `${item.mode} must mark the gap with ___`,
      ]);
    }
  });

  test("partner, transform and own sentence are typed: options must be null", () => {
    for (const item of [valid.partner, valid.transform, valid.own_sentence]) {
      const parsed = VocabExerciseOutput.safeParse({ ...item, options: ["a", "b", "c", "d"] });
      expect(parsed.success).toBe(false);
    }
  });

  test("own sentence: a gap is refused", () => {
    const parsed = VocabExerciseOutput.safeParse({ ...valid.own_sentence, prompt: "I ___ it." });
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
      "own_sentence asks for a whole sentence, not a gap",
    ]);
  });
});

describe("VocabExerciseInput and VocabCheckInput for lexical units", () => {
  test("an old word call still parses, as a word with no unit data", () => {
    expect(
      VocabExerciseInput.parse({ mode: "cloze", recent_accuracy: null, lemma: "decide" }),
    ).toMatchObject({ item_type: "word", particle: null, partner: null, forms: [] });
  });

  test("each unit type carries its facts", () => {
    const base = { recent_accuracy: null };
    expect(
      VocabExerciseInput.parse({
        ...base,
        mode: "particle",
        lemma: "give up",
        item_type: "phrasal_verb",
        verb: "give",
        particle: "up",
      }).particle,
    ).toBe("up");
    expect(
      VocabExerciseInput.parse({
        ...base,
        mode: "partner",
        lemma: "make a decision",
        item_type: "collocation",
        partner: "make",
      }).partner,
    ).toBe("make");
    expect(
      VocabExerciseInput.parse({
        ...base,
        mode: "transform",
        lemma: "decide",
        item_type: "word_family",
        forms: [{ pos: "noun", form: "decision" }],
        target_form: { pos: "noun", form: "decision" },
      }).target_form,
    ).toEqual({ pos: "noun", form: "decision" });
    expect(
      VocabExerciseInput.parse({ ...base, mode: "recognition", lemma: "x y", item_type: "idiom" })
        .item_type,
    ).toBe("idiom");
  });

  test("the judge takes typed modes only, own sentences included", () => {
    const check = {
      lemma: "give up",
      prompt: "p",
      accepted_answers: ["give up"],
      learner_answer: "",
    };
    expect(VocabCheckInput.safeParse({ ...check, mode: "own_sentence" }).success).toBe(true);
    expect(VocabCheckInput.safeParse({ ...check, mode: "transform" }).success).toBe(true);
    expect(VocabCheckInput.safeParse({ ...check, mode: "particle" }).success).toBe(false);
    expect(VocabCheckInput.safeParse({ ...check, mode: "recognition" }).success).toBe(false);
  });
});
