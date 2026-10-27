import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { type CardRow, type CefrLevel, type Skill, words } from "../db/schema";
import { awardCardRating, awardGrammarItem, awardTalkTurn } from "../gamification/awards";
import { topicById } from "../grammar/topics";
import { type Difficulty, recordGradedItem, seedLevels } from "./levels";
import { parseCefr } from "./model";

/**
 * What each grader's item is worth to the level model: its difficulty and its score. Kept here so
 * the graders make one call and the numbers live in one place. The same call awards the item's XP
 * (`src/gamification/`), against the learner's level before the item.
 */

/**
 * What a learner of the item's level scores on each kind on average, by design: the quiz skills
 * aim at 60–70 %, FSRS at 90 % retention; a conversation turn at the learner's own level is
 * mostly right with a slip or two. Passed as `expected` to `recordGradedItem`.
 */
export const ITEM_EXPECTED = { quiz: 0.65, card: 0.9, turn: 0.75, placement: 0.5 } as const;

/**
 * A grammar item's difficulty: its syllabus topic's level at step precision (`B1.4` → 2.4) when
 * the item has a validated `topic_id`, else the quiz's own CEFR estimate. The one place that
 * decides it.
 */
export function grammarItemDifficulty(item: {
  topic_id: string | null;
  difficulty: CefrLevel;
}): Difficulty {
  const level = item.topic_id ? topicById(item.topic_id)?.level : undefined;
  return (level === undefined ? undefined : parseCefr(level)) ?? item.difficulty;
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
  item: { topic_id: string | null; difficulty: CefrLevel },
  verdict: keyof typeof GRAMMAR_SCORES,
): Promise<void> {
  const difficulty = grammarItemDifficulty(item);
  const score = GRAMMAR_SCORES[verdict];
  const graded = await recordGradedItem(db, userId, "grammar", difficulty, score, {
    expected: ITEM_EXPECTED.quiz,
  });
  await awardGrammarItem(db, userId, {
    topicId: item.topic_id,
    verdict,
    score,
    itemLevel: graded.itemLevel,
    rating: graded.before,
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

/**
 * A rated vocabulary card, into the vocabulary level and XP. `card` is the card as it was before
 * the rating (its FSRS `state` says whether it was still being learned). Grammar-pattern cards
 * are not words.
 */
export async function recordCardRating(
  db: Db,
  userId: number,
  card: Pick<CardRow, "id" | "itemType" | "wordId" | "state">,
  rating: keyof typeof CARD_SCORES,
): Promise<void> {
  if (card.itemType === "grammar_pattern") return;
  const difficulty = await cardDifficulty(db, card);
  const score = CARD_SCORES[rating];
  const graded = await recordGradedItem(db, userId, "vocabulary", difficulty, score, {
    expected: ITEM_EXPECTED.card,
  });
  await awardCardRating(db, userId, {
    cardId: card.id,
    state: card.state,
    score,
    itemLevel: graded.itemLevel,
    rating: graded.before,
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

/** A corrected conversation turn, into the writing level and XP; a too-short turn records nothing. */
export async function recordTalkTurn(
  db: Db,
  userId: number,
  text: string,
  corrections: readonly { severity: keyof typeof CORRECTION_PENALTY }[],
): Promise<void> {
  const score = turnScore(text, corrections);
  if (score === null) return;
  await recordGradedItem(db, userId, "writing", null, score, { expected: ITEM_EXPECTED.turn });
  await awardTalkTurn(db, userId, score);
}
