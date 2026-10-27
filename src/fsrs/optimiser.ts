import {
  computeParameters,
  FSRSBinding,
  FSRSBindingItem,
  FSRSBindingReview,
} from "@open-spaced-repetition/binding";
import type { Db } from "../db/client";
import {
  getFsrsParameters,
  getFsrsProfileRow,
  type LoggedReview,
  listUserReviews,
  listUsersDueForOptimisation,
  saveOptimiserResult,
} from "../db/repositories/fsrs";
import { localDate } from "../routine/time";

/** Reviews a learner needs before their parameters are fitted at all. */
export const MIN_REVIEWS = 1000;
/** A learner's parameters are re-fitted at most this often. */
export const REFIT_EVERY_MS = 30 * 24 * 60 * 60_000;

// ts-fsrs `Rating`: 0 Manual (a reschedule, not a recall) is left out of the training data.
const isRecall = (rating: number) => rating >= 1 && rating <= 4;
const STATE_NEW = 0;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * The review log as FSRS training items. Per card, from its first review as a new card: the days
 * between consecutive reviews on the learner's calendar (0 on the same day), and one item per
 * review after the first, holding the history up to it. Returns the reviews used, too.
 */
export function trainingItems(
  reviews: readonly LoggedReview[],
  timezone: string,
): { items: FSRSBindingItem[]; reviewCount: number } {
  const byCard = new Map<number, LoggedReview[]>();
  for (const review of reviews) {
    if (!isRecall(review.rating)) continue;
    byCard.set(review.cardId, [...(byCard.get(review.cardId) ?? []), review]);
  }

  const items: FSRSBindingItem[] = [];
  let reviewCount = 0;
  for (const logged of byCard.values()) {
    const sorted = logged.toSorted((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());
    const start = sorted.findIndex((review) => review.state === STATE_NEW);
    if (start < 0) continue;
    const history = sorted.slice(start);
    reviewCount += history.length;
    let previousDay: number | undefined;
    const steps = history.map((review) => {
      const day = dayNumber(localDate(review.reviewedAt, timezone));
      const deltaT = previousDay === undefined ? 0 : day - previousDay;
      previousDay = day;
      return new FSRSBindingReview(review.rating, deltaT);
    });
    for (let i = 1; i < steps.length; i++) items.push(new FSRSBindingItem(steps.slice(0, i + 1)));
  }
  return { items, reviewCount };
}

/** The optimiser itself, behind a seam. */
export interface Fitter {
  /** Fitted FSRS-6 weights for `items`. */
  fit(items: FSRSBindingItem[]): Promise<number[]>;
  /** Log loss of `weights` (null: the defaults) on `items`; lower is better. */
  logLoss(weights: readonly number[] | null, items: FSRSBindingItem[]): number;
}

/** The official FSRS optimiser (fsrs-rs through `@open-spaced-repetition/binding`). */
export const bindingFitter: Fitter = {
  // No `timeout` option: the binding then holds the promise until the timeout runs out.
  fit: (items) => computeParameters(items, { enableShortTerm: true }),
  logLoss: (weights, items) =>
    new FSRSBinding(weights ? [...weights] : undefined).evaluate(items).logLoss,
};

export type OptimiseOutcome =
  | { kind: "skipped"; reason: "no-settings" | "too-few-reviews"; reviewCount: number }
  | { kind: "kept"; logLoss: number; candidate: number; reviewCount: number }
  | { kind: "fitted"; logLoss: number; previous: number; reviewCount: number };

/**
 * One optimiser run for one learner: fits parameters to their whole review log and keeps them only
 * when their log loss beats the weights in use (or the defaults) on that same log. Every run that
 * reaches a fit is recorded, so the next one waits `REFIT_EVERY_MS`.
 */
export async function optimise(
  db: Db,
  userId: number,
  now: Date,
  fitter: Fitter = bindingFitter,
): Promise<OptimiseOutcome> {
  const profile = await getFsrsProfileRow(db, userId);
  if (!profile) return { kind: "skipped", reason: "no-settings", reviewCount: 0 };
  const { items, reviewCount } = trainingItems(await listUserReviews(db, userId), profile.timezone);
  if (reviewCount < MIN_REVIEWS || items.length === 0) {
    return { kind: "skipped", reason: "too-few-reviews", reviewCount };
  }

  const current = (await getFsrsParameters(db, userId))?.weights ?? null;
  const candidate = await fitter.fit(items);
  const previous = fitter.logLoss(current, items);
  const fitted = fitter.logLoss(candidate, items);
  if (Number.isFinite(fitted) && fitted < previous) {
    await saveOptimiserResult(
      db,
      userId,
      { weights: candidate, logLoss: fitted, reviewCount },
      now,
    );
    return { kind: "fitted", logLoss: fitted, previous, reviewCount };
  }
  await saveOptimiserResult(db, userId, { logLoss: previous, reviewCount }, now);
  return { kind: "kept", logLoss: previous, candidate: fitted, reviewCount };
}

/** Learners whose optimiser run is due at `now`: enough reviews, not checked in the last month. */
export function usersDueForOptimisation(db: Db, now: Date): Promise<number[]> {
  return listUsersDueForOptimisation(db, MIN_REVIEWS, new Date(now.getTime() - REFIT_EVERY_MS));
}
