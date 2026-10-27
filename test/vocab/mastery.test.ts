import { describe, expect, test } from "bun:test";
import {
  EVIDENCE,
  evidenceBits,
  evidenceEarned,
  isLearned,
  LEARNED_INTERVAL_DAYS,
  missingEvidence,
  requiredEvidence,
} from "../../src/vocab/mastery";
import { modeFor } from "../../src/vocab/modes";

const ALL = requiredEvidence({ earWaived: false });
const heard = { earWaived: false };
const deaf = { earWaived: true };
const without = (...flags: (keyof typeof EVIDENCE)[]) => ALL & ~evidenceBits(flags);

describe("the learned rule", () => {
  test("all five kinds of evidence and an interval longer than 21 days", () => {
    expect(isLearned({ evidence: ALL, scheduledDays: LEARNED_INTERVAL_DAYS + 1 }, heard)).toBe(
      true,
    );
  });

  test("an interval of exactly 21 days is not enough", () => {
    expect(isLearned({ evidence: ALL, scheduledDays: LEARNED_INTERVAL_DAYS }, heard)).toBe(false);
  });

  test("any one missing kind of evidence keeps the card unlearned", () => {
    for (const flag of Object.keys(EVIDENCE) as (keyof typeof EVIDENCE)[]) {
      expect(isLearned({ evidence: without(flag), scheduledDays: 60 }, heard)).toBe(false);
    }
  });

  test("without TTS, listening is waived — and only listening", () => {
    expect(isLearned({ evidence: without("ear"), scheduledDays: 60 }, deaf)).toBe(true);
    expect(isLearned({ evidence: without("ear", "spelling"), scheduledDays: 60 }, deaf)).toBe(
      false,
    );
  });

  test("missing evidence comes in order: text, ear, recall, spelling, sentence", () => {
    expect(missingEvidence(0, heard)).toEqual(["text", "ear", "recall", "spelling", "sentence"]);
    expect(missingEvidence(0, deaf)).toEqual(["text", "recall", "spelling", "sentence"]);
    expect(missingEvidence(EVIDENCE.text | EVIDENCE.recall, heard)).toEqual([
      "ear",
      "spelling",
      "sentence",
    ]);
  });
});

describe("evidence earned by a right answer", () => {
  test("choices prove recognition, in text or by ear", () => {
    expect(evidenceEarned("recognition", "choice")).toEqual(["text"]);
    expect(evidenceEarned("particle", "choice")).toEqual(["text"]);
    expect(evidenceEarned("listening", "choice")).toEqual(["ear"]);
  });

  test("only an exact typed answer proves spelling", () => {
    expect(evidenceEarned("production", "exact")).toEqual(["recall", "spelling"]);
    expect(evidenceEarned("production", "correct")).toEqual(["recall"]);
    expect(evidenceEarned("cloze", "exact")).toEqual(["spelling"]);
    expect(evidenceEarned("cloze", "correct")).toEqual([]);
    expect(evidenceEarned("partner", "exact")).toEqual(["spelling"]);
    expect(evidenceEarned("transform", "exact")).toEqual(["spelling"]);
  });

  test("an own sentence is proved by the judge", () => {
    expect(evidenceEarned("own_sentence", "correct")).toEqual(["sentence"]);
  });
});

describe("the mode selector", () => {
  const fresh = { reps: 1, stability: 1 };
  const firm = { reps: 4, stability: 5 };
  const stable = { reps: 8, stability: 20 };

  test("a fresh card collects text, then ear, never production", () => {
    expect(modeFor({ ...fresh, evidence: 0 }, heard)).toBe("recognition");
    expect(modeFor({ ...fresh, evidence: EVIDENCE.text }, heard)).toBe("listening");
    // Nothing it may be asked for at its stage is missing: the rotation (recognition) runs.
    expect(modeFor({ ...fresh, evidence: EVIDENCE.text | EVIDENCE.ear }, heard)).toBe(
      "recognition",
    );
  });

  test("without TTS, listening is never picked", () => {
    expect(modeFor({ ...fresh, evidence: EVIDENCE.text }, deaf)).toBe("recognition");
    expect(modeFor({ ...firm, evidence: EVIDENCE.text }, deaf)).toBe("production");
  });

  test("a firmer card collects recall, then spelling", () => {
    const seen = EVIDENCE.text | EVIDENCE.ear;
    expect(modeFor({ ...firm, evidence: seen }, heard)).toBe("production");
    expect(modeFor({ ...firm, evidence: seen | EVIDENCE.recall }, heard)).toBe("cloze");
    // The sentence waits for a stable card.
    expect(modeFor({ ...firm, evidence: without("sentence") }, heard)).toBe("production");
  });

  test("a stable card is asked for its own sentence, then rotates", () => {
    expect(modeFor({ ...stable, evidence: without("sentence") }, heard)).toBe("own_sentence");
    expect(modeFor({ ...stable, evidence: ALL }, heard)).toBe("cloze");
  });

  test("earlier missing evidence comes first even on a stable card", () => {
    expect(modeFor({ ...stable, evidence: without("text") }, heard)).toBe("recognition");
  });

  test("spelling is the unit's own typed gap", () => {
    const evidence = without("spelling", "sentence");
    expect(modeFor({ ...firm, evidence, itemType: "collocation" }, heard)).toBe("partner");
    expect(modeFor({ ...firm, evidence, itemType: "word_family" }, heard)).toBe("transform");
    expect(modeFor({ ...firm, evidence, itemType: "idiom" }, heard)).toBe("cloze");
    expect(modeFor({ ...firm, evidence, itemType: "phrasal_verb" }, heard)).toBe("cloze");
  });
});
