import type { z } from "zod";
import type { CardRow } from "../db/schema";
import type { vocabMode } from "../skills";

export type VocabMode = z.infer<typeof vocabMode>;

/** Stability (days) from which a card is asked by typing the word rather than picking it. */
export const PRODUCTION_FROM_DAYS = 3;
/** Stability (days) from which a card is asked as a gap in a sentence. */
export const CLOZE_FROM_DAYS = 10;

/**
 * Exercise rotation by memory strength: a card the learner barely knows is recognised, a firmer
 * one is produced from its meaning, and a stable one is recalled in context.
 */
export function modeFor(card: Pick<CardRow, "stability" | "reps">): VocabMode {
  if (card.reps === 0 || card.stability < PRODUCTION_FROM_DAYS) return "recognition";
  if (card.stability < CLOZE_FROM_DAYS) return "production";
  return "cloze";
}
