import type { Db } from "../db/client";
import { addToXpTotal, countXpEvents, insertXpEvent, setXpLevel } from "../db/repositories/xp";
import type { XpSource } from "../db/schema";
import { domainEvents } from "../events/domain-events";
import { milestonesCrossed } from "../progress/streak-rules";
import { type XpAwarded, xpEvents, xpLog } from "./events";
import {
  DAILY_GOAL_XP,
  difficultyMultiplier,
  itemXp,
  profileLevel,
  streakXp,
  TOPIC_MASTERED_XP,
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

/** A graded quiz answer. */
export function awardGrammarItem(
  db: Db,
  userId: number,
  item: ItemPitch & { topicId: string | null; verdict: string; score: number },
  now?: Date,
): Promise<void> {
  return safely(userId, "grammar_item", async () => {
    await domainEvents.emit("grammar.answered", {
      userId,
      topicId: item.topicId,
      verdict: item.verdict,
      score: item.score,
      at: now ?? new Date(),
    });
    const amount = itemXp("grammar_item", item.score, item.itemLevel, item.rating);
    const meta = { verdict: item.verdict, ...(item.topicId ? { topicId: item.topicId } : {}) };
    await awardXp(db, userId, { source: "grammar_item", amount, meta }, now);
  });
}

/**
 * A syllabus topic's first mastery (`topic.mastered` with `first`), once per topic: a topic that
 * already earned it — also under the old count-based rule — earns nothing again. The bonus takes
 * the topic level's difficulty multiplier, so a topic far below the learner earns nothing.
 */
export function awardTopicMastered(
  db: Db,
  userId: number,
  topic: ItemPitch & { topicId: string },
  now?: Date,
): Promise<void> {
  return safely(userId, "topic_mastered", async () => {
    const { topicId } = topic;
    if ((await countXpEvents(db, userId, "topic_mastered", { topicId })) > 0) return;
    const amount = Math.floor(
      TOPIC_MASTERED_XP * difficultyMultiplier(topic.itemLevel, topic.rating),
    );
    await awardXp(db, userId, { source: "topic_mastered", amount, meta: { topicId } }, now);
  });
}

/**
 * A rated vocabulary card. `card.learned` says the rating made it learned (the caller applies the
 * active-mastery rule): a learned word, once per card; any other passing rating is a remembered
 * review.
 */
export function awardCardRating(
  db: Db,
  userId: number,
  card: ItemPitch & { cardId: number; learned: boolean; score: number },
  now?: Date,
): Promise<void> {
  return safely(userId, "card", async () => {
    const at = now ?? new Date();
    const learned =
      card.score > 0 &&
      card.learned &&
      (await countXpEvents(db, userId, "word_learned", { cardId: card.cardId })) === 0;
    await domainEvents.emit("card.rated", {
      userId,
      cardId: card.cardId,
      score: card.score,
      learned,
      at,
    });
    if (card.score <= 0) return;
    const source = learned ? "word_learned" : "review";
    const amount = itemXp(source, card.score, card.itemLevel, card.rating);
    const awarded = await awardXp(
      db,
      userId,
      { source, amount, meta: { cardId: card.cardId } },
      now,
    );
    // Once per card, like the ledger row that says it was learned.
    if (learned && awarded) {
      await domainEvents.emit("card.learned", { userId, cardId: card.cardId, at });
    }
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
 * The streak just went from `before` to `after` days (a goal day, or a restore that jumps): each
 * milestone it passed pays its bonus once per run — a run is named by its first day, `since`, so
 * a replayed session end pays nothing and a new run after a break earns the milestones again.
 * The award carries the streak, so the `day_streak` achievements see it.
 */
export function awardStreakMilestones(
  db: Db,
  userId: number,
  { before, after, since }: { before: number; after: number; since: string },
  now?: Date,
): Promise<void> {
  return safely(userId, "streak_milestone", async () => {
    for (const { days, xp } of milestonesCrossed(before, after)) {
      if ((await countXpEvents(db, userId, "streak", { milestone: days, since })) > 0) continue;
      const meta = { milestone: days, since, streak: after };
      await awardXp(db, userId, { source: "streak", amount: xp, meta }, now);
    }
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
