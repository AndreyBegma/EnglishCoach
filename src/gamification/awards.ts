import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { addToXpTotal, countXpEvents, insertXpEvent, setXpLevel } from "../db/repositories/xp";
import type { XpSource } from "../db/schema";
import { type XpAwarded, xpEvents, xpLog } from "./events";
import {
  DAILY_GOAL_XP,
  itemXp,
  profileLevel,
  streakXp,
  TOPIC_MASTERED_XP,
  topicJustMastered,
} from "./xp";

export type XpAward = { source: XpSource; amount: number; meta?: Record<string, unknown> };

/**
 * Writes one award to the ledger and the cached total and level, in one transaction, then emits
 * `xp.awarded`. An amount of 0 (an item far below the learner, a wrong answer) writes nothing.
 */
export async function awardXp(
  db: Db,
  userId: number,
  { source, amount, meta = {} }: XpAward,
  now: Date = new Date(),
): Promise<XpAwarded | undefined> {
  if (!Number.isInteger(amount) || amount <= 0) return undefined;
  const awarded = await db.transaction(async (tx) => {
    await insertXpEvent(tx, userId, { source, amount, meta }, now);
    const total = await addToXpTotal(tx, userId, amount, now);
    const { level } = profileLevel(total);
    await setXpLevel(tx, userId, level);
    return {
      userId,
      source,
      amount,
      meta,
      total,
      level,
      previousLevel: profileLevel(total - amount).level,
    };
  });
  await xpEvents.emit(awarded);
  return awarded;
}

/** XP never fails the grader that earned it: a failed award is logged and dropped. */
async function safely(userId: number, what: string, award: () => Promise<void>): Promise<void> {
  try {
    await award();
  } catch (error) {
    xpLog.warn("xp award failed", { userId, what, error });
  }
}

/** Where an item sat for the learner: its level and theirs, on the level model's scale. */
export type ItemPitch = { itemLevel: number; rating: number };

/**
 * A graded quiz answer. A correct answer that is the learner's `MASTERY_CORRECT`-th rewarded one
 * on its syllabus topic also masters the topic, once.
 */
export function awardGrammarItem(
  db: Db,
  userId: number,
  item: ItemPitch & { topicId: string | null; verdict: string; score: number },
  now?: Date,
): Promise<void> {
  return safely(userId, "grammar_item", async () => {
    const amount = itemXp("grammar_item", item.score, item.itemLevel, item.rating);
    const meta = { verdict: item.verdict, ...(item.topicId ? { topicId: item.topicId } : {}) };
    const awarded = await awardXp(db, userId, { source: "grammar_item", amount, meta }, now);
    if (!awarded || item.verdict !== "correct" || !item.topicId) return;
    const correct = await countXpEvents(db, userId, "grammar_item", {
      topicId: item.topicId,
      verdict: "correct",
    });
    if (topicJustMastered(correct)) {
      await awardXp(
        db,
        userId,
        { source: "topic_mastered", amount: TOPIC_MASTERED_XP, meta: { topicId: item.topicId } },
        now,
      );
    }
  });
}

/**
 * A rated vocabulary card. The first passing rating of a card still being learned (New or
 * Learning) is a learned word, once per card; any other passing rating is a remembered review.
 */
export function awardCardRating(
  db: Db,
  userId: number,
  card: ItemPitch & { cardId: number; state: number; score: number },
  now?: Date,
): Promise<void> {
  return safely(userId, "card", async () => {
    if (card.score <= 0) return;
    const learning = card.state === State.New || card.state === State.Learning;
    const learned =
      learning && (await countXpEvents(db, userId, "word_learned", { cardId: card.cardId })) === 0;
    const source = learned ? "word_learned" : "review";
    const amount = itemXp(source, card.score, card.itemLevel, card.rating);
    await awardXp(db, userId, { source, amount, meta: { cardId: card.cardId } }, now);
  });
}

/** A conversation turn long enough to count; it is pitched at the learner's own level. */
export function awardTalkTurn(db: Db, userId: number, score: number, now?: Date): Promise<void> {
  return safely(userId, "talk_turn", async () => {
    await awardXp(
      db,
      userId,
      { source: "talk_turn", amount: itemXp("talk_turn", score, 0, 0) },
      now,
    );
  });
}

/**
 * The daily goal was just met on the learner-local `date`, `streak` days in a row counting it:
 * the goal bonus, and the streak bonus from the second day.
 */
export function awardGoalMet(
  db: Db,
  userId: number,
  { date, streak }: { date: string; streak: number },
  now?: Date,
): Promise<void> {
  return safely(userId, "daily_goal", async () => {
    await awardXp(db, userId, { source: "daily_goal", amount: DAILY_GOAL_XP, meta: { date } }, now);
    await awardXp(
      db,
      userId,
      { source: "streak", amount: streakXp(streak), meta: { date, streak } },
      now,
    );
  });
}
