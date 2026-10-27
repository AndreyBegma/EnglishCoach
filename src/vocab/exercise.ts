import type { CardRow } from "../db/schema";
import type { SkillOutput, SkillVars } from "../skills";
import type { VocabMode } from "./modes";
import { exampleText } from "./render";

type ExerciseVars = SkillVars<"vocab-exercise">;
type Exercise = SkillOutput<"vocab-exercise">;

/**
 * The exercise the model wrote contradicts what the server knows about the unit (a particle
 * question whose right option is not the verb's particle, a mode it was not asked for). Treated
 * like an invalid model output: the learner gets Retry, nothing is written.
 */
export class ExerciseCheckError extends Error {
  override name = "ExerciseCheckError";
}

const normalise = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/** The card's item type as the exercise skills know it: a learner's own word is a word. */
export function exerciseItemType(
  card: Pick<CardRow, "itemType">,
): NonNullable<ExerciseVars["item_type"]> {
  switch (card.itemType) {
    case "collocation":
    case "phrasal_verb":
    case "idiom":
    case "word_family":
      return card.itemType;
    default:
      return "word";
  }
}

/**
 * The family form a `transform` exercise asks for: every form but the lemma in turn, one step
 * further at each review, so the learner meets them all. Null when the card has no other form.
 */
export function targetForm(
  card: Pick<CardRow, "front" | "backJson" | "reps">,
): { pos: string; form: string } | null {
  const unit = card.backJson.unit;
  if (unit?.kind !== "word_family") return null;
  const others = unit.forms.filter((form) => normalise(form.form) !== normalise(card.front));
  return others[card.reps % Math.max(others.length, 1)] ?? null;
}

/**
 * The mode actually asked: a unit mode whose data the card lacks (a card made before its unit had
 * details) falls back to the word rotation's equivalent.
 */
export function effectiveMode(card: Pick<CardRow, "front" | "backJson" | "reps">, mode: VocabMode) {
  const unit = card.backJson.unit;
  if (mode === "particle") return unit?.kind === "phrasal_verb" ? mode : "production";
  if (mode === "partner") return unit?.kind === "collocation" ? mode : "cloze";
  if (mode === "transform") return targetForm(card) ? mode : "cloze";
  return mode;
}

/** The `vocab-exercise` vars for `card` in `mode`: the card plus what the server knows about the unit. */
export function exerciseVars(
  card: Pick<CardRow, "front" | "backJson" | "reps" | "itemType">,
  mode: VocabMode,
  extra: { recent_accuracy: number | null; distractors: string[] },
): ExerciseVars {
  const back = card.backJson;
  const unit = back.unit;
  return {
    mode,
    recent_accuracy: extra.recent_accuracy,
    lemma: card.front,
    pos: back.pos ?? null,
    translation: back.translation ?? null,
    examples: back.examples?.map(exampleText) ?? [],
    distractors: extra.distractors,
    item_type: exerciseItemType(card),
    verb: unit?.kind === "phrasal_verb" ? unit.verb : null,
    particle: unit?.kind === "phrasal_verb" ? unit.particle : null,
    partner: unit?.kind === "collocation" ? unit.partner : null,
    forms: unit?.kind === "word_family" ? unit.forms : [],
    target_form: mode === "transform" ? targetForm(card) : null,
  };
}

/**
 * Holds the model's exercise to the server's facts and returns it ready to show. The mode must be
 * the one asked; a particle question's right option must be the verb's particle (re-pointed when
 * the model marked another option but listed it); a partner or transform gap always accepts the
 * server's word. Throws `ExerciseCheckError` when the exercise cannot be trusted.
 */
export function settleExercise(vars: ExerciseVars, data: Exercise): Exercise {
  if (data.mode !== vars.mode) {
    throw new ExerciseCheckError(`asked for ${vars.mode}, got ${data.mode}`);
  }
  if (data.mode === "particle" && vars.particle && data.options) {
    const index = data.options.findIndex(
      (option) => normalise(option) === normalise(vars.particle ?? ""),
    );
    if (index < 0) throw new ExerciseCheckError(`no option is the particle "${vars.particle}"`);
    return { ...data, correct_index: index, accepted_answers: [data.options[index] ?? ""] };
  }
  const forced =
    data.mode === "partner"
      ? vars.partner
      : data.mode === "transform"
        ? vars.target_form?.form
        : null;
  if (forced && !data.accepted_answers.some((answer) => normalise(answer) === normalise(forced))) {
    return { ...data, accepted_answers: [forced, ...data.accepted_answers] };
  }
  return data;
}
