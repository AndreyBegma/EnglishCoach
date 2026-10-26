import type { CefrLevel } from "../db/schema/enums";
import { PLACEMENT_MAX_ITEMS, type SkillOutput } from "../skills";

export type PlacementOutput = SkillOutput<"placement-test">;
export type PlacementItem = NonNullable<PlacementOutput["item"]>;

/** One graded item, as the skill's input wants it. */
export interface PlacementAnswer {
  level: CefrLevel;
  skill: PlacementItem["skill"];
  topic: string;
  correct: boolean;
}

export type PlacementStep =
  | { kind: "item"; item: PlacementItem }
  | { kind: "final"; level: CefrLevel; summary: string | null };

/** The skill returned something the test cannot continue from. A model bug, not a user error. */
export class PlacementError extends Error {
  override name = "PlacementError";
}

/** The server grades: items are multiple choice with a known correct index. */
export function grade(item: PlacementItem, chosen: number): PlacementAnswer {
  return {
    level: item.level,
    skill: item.skill,
    topic: item.topic,
    correct: chosen === item.correct_index,
  };
}

/**
 * Decides what the skill's reply means after `answers` items. The test ends when the skill says
 * `final` (it does so early once it is confident) or at the item limit, whatever the skill says.
 * A `final` with no answers behind it is refused: it would store a level nobody tested.
 */
export function nextStep(
  answers: readonly PlacementAnswer[],
  output: PlacementOutput,
): PlacementStep {
  if (output.status === "final") {
    if (answers.length === 0) throw new PlacementError("placement ended before any item");
    return { kind: "final", level: output.estimate.level, summary: output.summary };
  }
  if (answers.length >= PLACEMENT_MAX_ITEMS) {
    return { kind: "final", level: output.estimate.level, summary: null };
  }
  if (!output.item) throw new PlacementError("placement continued without an item");
  return { kind: "item", item: output.item };
}

/** The first sentence of the skill's summary: the one-line justification kept in the hub. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const end = trimmed.search(/[.!?…。](\s|$)/);
  return end === -1 ? trimmed : trimmed.slice(0, end + 1);
}
