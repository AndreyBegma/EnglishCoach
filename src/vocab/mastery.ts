import type { CardRow } from "../db/schema";
import type { VocabMode } from "./modes";

/**
 * The five kinds of evidence that a word is actively mastered, as bits of `cards.evidence`:
 * recognised in text, recognised by ear, recalled from the translation, spelled correctly, used in
 * a sentence of the learner's own.
 */
export const EVIDENCE = { text: 1, ear: 2, recall: 4, spelling: 8, sentence: 16 } as const;

export type Evidence = keyof typeof EVIDENCE;

/** The order the mode selector collects missing evidence in: easiest first. */
export const EVIDENCE_ORDER = [
  "text",
  "ear",
  "recall",
  "spelling",
  "sentence",
] as const satisfies readonly Evidence[];

/** A learned card's FSRS interval is longer than this many days. */
export const LEARNED_INTERVAL_DAYS = 21;

/**
 * Whether listening evidence is waived: a learner without TTS (no engine can voice the word for
 * them, or voice is off) cannot be asked by ear, and that must not keep a word from being learned.
 */
export interface MasteryContext {
  earWaived: boolean;
}

/** The bits a card must hold to be learned. */
export function requiredEvidence({ earWaived }: MasteryContext): number {
  return EVIDENCE_ORDER.reduce(
    (bits, flag) => (flag === "ear" && earWaived ? bits : bits | EVIDENCE[flag]),
    0,
  );
}

export function evidenceBits(flags: readonly Evidence[]): number {
  return flags.reduce((bits, flag) => bits | EVIDENCE[flag], 0);
}

/** The required evidence `bits` lacks, in `EVIDENCE_ORDER`. */
export function missingEvidence(bits: number, context: MasteryContext): Evidence[] {
  const required = requiredEvidence(context);
  return EVIDENCE_ORDER.filter((flag) => required & EVIDENCE[flag] && !(bits & EVIDENCE[flag]));
}

/**
 * The learned rule: every required kind of evidence, and an FSRS interval of more than
 * `LEARNED_INTERVAL_DAYS` days. `scheduledDays` is the interval after the latest rating.
 */
export function isLearned(
  card: Pick<CardRow, "evidence" | "scheduledDays">,
  context: MasteryContext,
): boolean {
  return (
    missingEvidence(card.evidence, context).length === 0 &&
    card.scheduledDays > LEARNED_INTERVAL_DAYS
  );
}

/**
 * How an answer was judged: a choice picked right, a typed answer that matched an accepted one
 * exactly, or one the judge called correct without an exact match.
 */
export type Judgement = "choice" | "exact" | "correct";

/**
 * What a right answer in `mode` proves. Only an exact typed match proves spelling; the judge's
 * "correct" proves the recall but may hide a slip. A wrong or "close" answer proves nothing and
 * never reaches here.
 */
export function evidenceEarned(mode: VocabMode, judgement: Judgement): Evidence[] {
  switch (mode) {
    case "recognition":
    case "particle":
      return judgement === "choice" ? ["text"] : [];
    case "listening":
      return judgement === "choice" ? ["ear"] : [];
    case "production":
      return judgement === "exact" ? ["recall", "spelling"] : ["recall"];
    case "cloze":
    case "partner":
    case "transform":
      return judgement === "exact" ? ["spelling"] : [];
    case "own_sentence":
      return judgement === "correct" ? ["sentence"] : [];
  }
}
