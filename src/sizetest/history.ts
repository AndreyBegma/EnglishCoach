import type { Db } from "../db/client";
import { listSizeTests } from "../db/repositories/sizetest";
import { getSettings } from "../db/repositories/users";
import type { VocabSizeTestRow } from "../db/schema";

/** A new test is offered once this many days have passed since the last one. */
export const RETEST_DAYS = 30;
const DAY_MS = 86_400_000;

/** The size line of Progress and the vocabulary level: the latest result and whether to retest. */
export interface VocabSizeBlock {
  /** Null before the first test. */
  latest: {
    words: number;
    /** Whole percent of everyday text covered at that size. */
    coverage: number;
    /** The estimate before it, for the trend; null after the first test. */
    previous: number | null;
    testedAt: Date;
  } | null;
  /** Whether the monthly test is offered now (`sizeTestDue`). */
  due: boolean;
}

function isDue(hasLevel: boolean, last: VocabSizeTestRow | undefined, now: Date): boolean {
  if (!hasLevel) return false;
  return !last || now.getTime() - last.finishedAt.getTime() >= RETEST_DAYS * DAY_MS;
}

/** The learner's size history as Progress shows it. */
export async function loadVocabSize(
  db: Db,
  userId: number,
  now: Date = new Date(),
): Promise<VocabSizeBlock> {
  const [settings, [latest, previous]] = await Promise.all([
    getSettings(db, userId),
    listSizeTests(db, userId, 2),
  ]);
  return {
    latest: latest
      ? {
          words: latest.estimate,
          coverage: Math.round(latest.coverageBp / 100),
          previous: previous?.estimate ?? null,
          testedAt: latest.finishedAt,
        }
      : null,
    due: isDue(Boolean(settings?.cefrLevel), latest, now),
  };
}

/**
 * Whether to offer the size test now: the learner has a level (placement done) and has not taken
 * one in the last `RETEST_DAYS` days. The one function the daily plan (C-47) calls; until it
 * exists, the hub and Progress ask it.
 */
export async function sizeTestDue(
  db: Db,
  userId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const [settings, [latest]] = await Promise.all([
    getSettings(db, userId),
    listSizeTests(db, userId, 1),
  ]);
  return isDue(Boolean(settings?.cefrLevel), latest, now);
}
