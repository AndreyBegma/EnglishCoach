import { asc, count, eq, gte, isNull, lt, or } from "drizzle-orm";
import type { Db } from "../client";
import { cards, type FsrsParametersRow, fsrsParameters, reviewLogs, userSettings } from "../schema";
import type { Tx } from "./levels";

/** The learner's retention setting and fitted weights; undefined when the user has no settings. */
export async function getFsrsProfileRow(
  db: Tx,
  userId: number,
): Promise<{ retention: number; weights: number[] | null; timezone: string } | undefined> {
  const [row] = await db
    .select({
      retention: userSettings.desiredRetention,
      timezone: userSettings.timezone,
      weights: fsrsParameters.weights,
    })
    .from(userSettings)
    .leftJoin(fsrsParameters, eq(fsrsParameters.userId, userSettings.userId))
    .where(eq(userSettings.userId, userId));
  return row;
}

export async function getFsrsParameters(
  db: Db,
  userId: number,
): Promise<FsrsParametersRow | undefined> {
  const [row] = await db.select().from(fsrsParameters).where(eq(fsrsParameters.userId, userId));
  return row;
}

/** One logged review, as the optimiser reads it. */
export interface LoggedReview {
  cardId: number;
  rating: number;
  state: number;
  reviewedAt: Date;
}

/** Every review of the learner's cards, card by card, oldest first. */
export async function listUserReviews(db: Db, userId: number): Promise<LoggedReview[]> {
  return db
    .select({
      cardId: reviewLogs.cardId,
      rating: reviewLogs.rating,
      state: reviewLogs.state,
      reviewedAt: reviewLogs.reviewedAt,
    })
    .from(reviewLogs)
    .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
    .where(eq(cards.userId, userId))
    .orderBy(asc(reviewLogs.cardId), asc(reviewLogs.reviewedAt), asc(reviewLogs.id));
}

/**
 * Learners the optimiser should run for at `now`: at least `minReviews` logged reviews, and no run
 * yet or the last one before `checkedBefore`.
 */
export async function listUsersDueForOptimisation(
  db: Db,
  minReviews: number,
  checkedBefore: Date,
): Promise<number[]> {
  const rows = await db
    .select({ userId: cards.userId })
    .from(reviewLogs)
    .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
    .leftJoin(fsrsParameters, eq(fsrsParameters.userId, cards.userId))
    .where(or(isNull(fsrsParameters.checkedAt), lt(fsrsParameters.checkedAt, checkedBefore)))
    .groupBy(cards.userId)
    .having(gte(count(), minReviews))
    .orderBy(asc(cards.userId));
  return rows.map((row) => row.userId);
}

/** The outcome of one optimiser run. `weights` undefined keeps the weights in use. */
export interface OptimiserResult {
  weights?: number[];
  logLoss: number;
  reviewCount: number;
}

/** Records an optimiser run at `now`, replacing the weights only when the run brought new ones. */
export async function saveOptimiserResult(
  db: Db,
  userId: number,
  result: OptimiserResult,
  now: Date,
): Promise<void> {
  const fitted = result.weights ? { weights: result.weights, fittedAt: now } : {};
  await db
    .insert(fsrsParameters)
    .values({
      userId,
      logLoss: result.logLoss,
      reviewCount: result.reviewCount,
      checkedAt: now,
      ...fitted,
    })
    .onConflictDoUpdate({
      target: fsrsParameters.userId,
      set: { logLoss: result.logLoss, reviewCount: result.reviewCount, checkedAt: now, ...fitted },
    });
}
