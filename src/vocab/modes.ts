import type { z } from "zod";
import type { CardRow } from "../db/schema";
import type { vocabMode } from "../skills";

export type VocabMode = z.infer<typeof vocabMode>;

/** Stability (days) from which a card is asked by typing the word rather than picking it. */
export const PRODUCTION_FROM_DAYS = 3;
/** Stability (days) from which a card is asked as a gap in a sentence. */
export const CLOZE_FROM_DAYS = 10;

/** The three stages of memory strength, per item type: barely known, firmer, stable. */
const ROTATION: Record<string, readonly [VocabMode, VocabMode, VocabMode]> = {
  phrasal_verb: ["recognition", "particle", "own_sentence"],
  collocation: ["recognition", "partner", "partner"],
  word_family: ["recognition", "transform", "transform"],
};
const WORD_ROTATION = ["recognition", "production", "cloze"] as const;

/**
 * Exercise rotation by memory strength: a card the learner barely knows is recognised, a firmer
 * one is produced from its meaning, and a stable one is recalled in context. Lexical units have
 * their own: a phrasal verb's particle then a sentence of the learner's own, a collocation's
 * partner word, a word family's other forms. Idioms rotate like words.
 */
export function modeFor(
  card: Pick<CardRow, "stability" | "reps"> & Partial<Pick<CardRow, "itemType">>,
): VocabMode {
  const stage =
    card.reps === 0 || card.stability < PRODUCTION_FROM_DAYS
      ? 0
      : card.stability < CLOZE_FROM_DAYS
        ? 1
        : 2;
  return (ROTATION[card.itemType ?? "word"] ?? WORD_ROTATION)[stage];
}
