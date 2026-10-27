import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { type CardRow, type CefrLevel, grammarTopics, type Skill, words } from "../db/schema";
import { type Difficulty, recordGradedItem, seedLevels } from "./levels";

/**
 * What each grader's item is worth to the level model: its difficulty and its score. Kept here so
 * the graders make one call and the numbers live in one place.
 */

/**
 * What a learner of the item's level scores on each kind on average, by design: the quiz skills
 * aim at 60–70 %, FSRS at 90 % retention; a conversation turn at the learner's own level is
 * mostly right with a slip or two. Passed as `expected` to `recordGradedItem`.
 */
export const ITEM_EXPECTED = { quiz: 0.65, card: 0.9, turn: 0.75, placement: 0.5 } as const;

const SYLLABUS_TOPIC = /^g\d{3}$/;

/**
 * A grammar item's difficulty: the level of its syllabus topic when the item names one (a `gNNN`
 * id of the course), else the quiz's own CEFR estimate. The one place that decides it.
 */
export async function grammarItemDifficulty(
  db: Db,
  item: { topic: string; difficulty: CefrLevel },
): Promise<CefrLevel> {
  if (!SYLLABUS_TOPIC.test(item.topic)) return item.difficulty;
  const [topic] = await db
    .select({ cefrLevel: grammarTopics.cefrLevel })
    .from(grammarTopics)
    .where(eq(grammarTopics.id, item.topic));
  return topic?.cefrLevel ?? item.difficulty;
}

/**
 * A finished placement test: every skill starts at the test's level, then each graded item moves
 * its own skill, so the test leaves a level per skill and not just one.
 */
export async function recordPlacement(
  db: Db,
  userId: number,
  level: CefrLevel,
  answers: readonly { level: CefrLevel; skill: Skill; correct: boolean }[],
): Promise<void> {
  await seedLevels(db, userId, level, "placement");
  for (const answer of answers) {
    await recordGradedItem(db, userId, answer.skill, answer.level, answer.correct ? 1 : 0, {
      expected: ITEM_EXPECTED.placement,
    });
  }
}

/** A partial answer is shown as a pass but counts half. */
export const GRAMMAR_SCORES = { correct: 1, partial: 0.5, wrong: 0 } as const;

/** A graded quiz answer, into the grammar level. */
export async function recordGrammarItem(
  db: Db,
  userId: number,
  item: { topic: string; difficulty: CefrLevel },
  verdict: keyof typeof GRAMMAR_SCORES,
): Promise<void> {
  const difficulty = await grammarItemDifficulty(db, item);
  await recordGradedItem(db, userId, "grammar", difficulty, GRAMMAR_SCORES[verdict], {
    expected: ITEM_EXPECTED.quiz,
  });
}

/** A card's difficulty: its dictionary word's level; a learner's own card is at their level. */
export async function cardDifficulty(db: Db, card: { wordId: number | null }): Promise<Difficulty> {
  if (card.wordId === null) return null;
  const [word] = await db
    .select({ cefrLevel: words.cefrLevel })
    .from(words)
    .where(eq(words.id, card.wordId));
  return word?.cefrLevel ?? null;
}

/** FSRS ratings as scores: Hard is a recall that took effort. */
export const CARD_SCORES = { again: 0, hard: 0.5, good: 1, easy: 1 } as const;

/** A rated vocabulary card, into the vocabulary level. Grammar-pattern cards are not words. */
export async function recordCardRating(
  db: Db,
  userId: number,
  card: Pick<CardRow, "itemType" | "wordId">,
  rating: keyof typeof CARD_SCORES,
): Promise<void> {
  if (card.itemType === "grammar_pattern") return;
  const difficulty = await cardDifficulty(db, card);
  await recordGradedItem(db, userId, "vocabulary", difficulty, CARD_SCORES[rating], {
    expected: ITEM_EXPECTED.card,
  });
}

/** What one correction of each severity takes off a conversation turn's score. */
const CORRECTION_PENALTY = { critical: 0.5, moderate: 0.25, minor: 0.1 } as const;

/** Shorter turns ("ok", "yes, thanks") say nothing about the learner's writing. */
export const MIN_TURN_WORDS = 5;

/**
 * A conversation turn's score from its corrections, or null when the turn is too short to count.
 * The turn is pitched at the learner's own level (`ITEM_EXPECTED.turn`).
 */
export function turnScore(
  text: string,
  corrections: readonly { severity: keyof typeof CORRECTION_PENALTY }[],
): number | null {
  if (text.split(/\s+/).filter(Boolean).length < MIN_TURN_WORDS) return null;
  const penalty = corrections.reduce((sum, c) => sum + CORRECTION_PENALTY[c.severity], 0);
  return Math.max(0, 1 - penalty);
}

/** A corrected conversation turn, into the writing level; a too-short turn records nothing. */
export async function recordTalkTurn(
  db: Db,
  userId: number,
  text: string,
  corrections: readonly { severity: keyof typeof CORRECTION_PENALTY }[],
): Promise<void> {
  const score = turnScore(text, corrections);
  if (score === null) return;
  await recordGradedItem(db, userId, "writing", null, score, { expected: ITEM_EXPECTED.turn });
}
