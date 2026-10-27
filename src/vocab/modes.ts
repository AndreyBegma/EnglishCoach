import type { z } from "zod";
import type { CardRow } from "../db/schema";
import type { vocabMode } from "../skills";
import { type Evidence, type MasteryContext, missingEvidence } from "./mastery";

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

/** The stage from which each kind of evidence may be asked for: a fresh card is never produced. */
const EVIDENCE_FROM_STAGE: Record<Evidence, 0 | 1 | 2> = {
  text: 0,
  ear: 0,
  recall: 1,
  spelling: 1,
  sentence: 2,
};

type ModeCard = Pick<CardRow, "stability" | "reps"> &
  Partial<Pick<CardRow, "itemType" | "evidence">>;

function stageOf(card: Pick<CardRow, "stability" | "reps">): 0 | 1 | 2 {
  if (card.reps === 0 || card.stability < PRODUCTION_FROM_DAYS) return 0;
  return card.stability < CLOZE_FROM_DAYS ? 1 : 2;
}

/** The mode that collects `evidence` for an item type: spelling is the unit's own typed gap. */
export function modeForEvidence(evidence: Evidence, itemType = "word"): VocabMode {
  switch (evidence) {
    case "text":
      return "recognition";
    case "ear":
      return "listening";
    case "recall":
      return "production";
    case "spelling":
      return itemType === "collocation"
        ? "partner"
        : itemType === "word_family"
          ? "transform"
          : "cloze";
    case "sentence":
      return "own_sentence";
  }
}

/**
 * Exercise rotation: the evidence of active mastery the card still lacks comes first, easiest
 * first, as far as its memory stage allows (`EVIDENCE_FROM_STAGE`). Once the card holds all it may
 * be asked for at its stage, the rotation by memory strength runs: a card the learner barely knows
 * is recognised, a firmer one is produced from its meaning, and a stable one is recalled in
 * context. Lexical units have their own: a phrasal verb's particle then a sentence of the learner's
 * own, a collocation's partner word, a word family's other forms. Idioms rotate like words.
 */
export function modeFor(card: ModeCard, context: MasteryContext = { earWaived: true }): VocabMode {
  const stage = stageOf(card);
  const missing = missingEvidence(card.evidence ?? 0, context).find(
    (evidence) => EVIDENCE_FROM_STAGE[evidence] <= stage,
  );
  if (missing) return modeForEvidence(missing, card.itemType);
  return (ROTATION[card.itemType ?? "word"] ?? WORD_ROTATION)[stage];
}
