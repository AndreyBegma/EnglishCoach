import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createEmptyCard, default_w, Rating } from "ts-fsrs";
import type { Database } from "../../src/db/client";
import { fsrsCardToColumns } from "../../src/db/fsrs";
import { getFsrsParameters } from "../../src/db/repositories/fsrs";
import { getOrCreateUser, updateSettings } from "../../src/db/repositories/users";
import { cards, fsrsParameters, reviewLogs } from "../../src/db/schema";
import { fsrsFor, fsrsProfile } from "../../src/fsrs";
import {
  bindingFitter,
  type Fitter,
  MIN_REVIEWS,
  optimise,
  REFIT_EVERY_MS,
  usersDueForOptimisation,
} from "../../src/fsrs/optimiser";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { syntheticLog } from "./synthetic-log";

const DAY = 86_400_000;
const start = new Date("2026-01-01T09:00:00Z");
const now = new Date("2026-10-27T12:00:00Z");

describe.skipIf(!testServerUrl)("the FSRS optimiser job", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  /** A learner with `cardCount` cards × `reviewsPerCard` reviews of a synthetic log. */
  async function learnerWithLog(telegramId: number, cardCount: number, reviewsPerCard: number) {
    const user = await getOrCreateUser(database.db, { telegramId });
    await updateSettings(database.db, user.id, { timezone: "UTC" });
    const logs = syntheticLog({ cards: cardCount, reviewsPerCard, start, seed: telegramId });
    const inserted = await database.db
      .insert(cards)
      .values(
        logs.map((_, i) => ({
          userId: user.id,
          itemType: "user_word" as const,
          front: `word-${i}`,
          ...fsrsCardToColumns(createEmptyCard(start)),
        })),
      )
      .returning({ id: cards.id });
    const rows = logs.flatMap((cardLogs, i) =>
      cardLogs.map((log) => ({ ...log, cardId: inserted[i]?.id ?? 0 })),
    );
    for (let i = 0; i < rows.length; i += 500) {
      await database.db.insert(reviewLogs).values(rows.slice(i, i + 500));
    }
    return { userId: user.id, reviewCount: rows.length };
  }

  test("fits a learner past the threshold, keeps the better weights and schedules with them", async () => {
    const { userId, reviewCount } = await learnerWithLog(5001, 200, 7);
    expect(reviewCount).toBeGreaterThanOrEqual(MIN_REVIEWS);
    expect(await usersDueForOptimisation(database.db, now)).toContain(userId);

    const outcome = await optimise(database.db, userId, now);
    if (outcome.kind !== "fitted") throw new Error(`expected a fit, got ${outcome.kind}`);
    expect(outcome.logLoss).toBeLessThan(outcome.previous);
    expect(outcome.reviewCount).toBe(reviewCount);

    const stored = await getFsrsParameters(database.db, userId);
    expect(stored?.weights).toHaveLength(21);
    expect(stored?.fittedAt).toEqual(now);
    expect(stored?.checkedAt).toEqual(now);
    expect(stored?.logLoss).toBeCloseTo(outcome.logLoss, 10);

    // The learner's scheduler now runs their weights, not the defaults.
    expect((await fsrsProfile(database.db, userId)).weights).toEqual(stored?.weights ?? []);
    const theirs = await fsrsFor(database.db, userId);
    expect([...theirs.parameters.w]).not.toEqual([...default_w]);

    // Checked just now: not due again until a month has passed.
    expect(await usersDueForOptimisation(database.db, now)).not.toContain(userId);
    const nextMonth = new Date(now.getTime() + REFIT_EVERY_MS + DAY);
    expect(await usersDueForOptimisation(database.db, nextMonth)).toContain(userId);
  });

  test("keeps the weights in use when the new fit's log loss is not better", async () => {
    const { userId } = await learnerWithLog(5002, 200, 7);
    // A fit that forgets almost at once: far worse than the defaults on this log.
    const worse: Fitter = {
      fit: async () => default_w.map((w, i) => (i < 4 ? 0.01 : w)),
      logLoss: bindingFitter.logLoss,
    };
    const outcome = await optimise(database.db, userId, now, worse);
    if (outcome.kind !== "kept") throw new Error(`expected kept, got ${outcome.kind}`);
    expect(outcome.candidate).toBeGreaterThan(outcome.logLoss);

    const stored = await getFsrsParameters(database.db, userId);
    expect(stored?.weights).toBeNull();
    expect(stored?.fittedAt).toBeNull();
    // Still recorded, so the monthly pacing holds.
    expect(stored?.checkedAt).toEqual(now);
    expect(await usersDueForOptimisation(database.db, now)).not.toContain(userId);
  });

  test("does not fit a learner under the threshold, and does not list them", async () => {
    const { userId, reviewCount } = await learnerWithLog(5003, 50, 5);
    expect(reviewCount).toBeLessThan(MIN_REVIEWS);
    expect(await usersDueForOptimisation(database.db, now)).not.toContain(userId);
    const fitter: Fitter = {
      fit: () => Promise.reject(new Error("must not fit")),
      logLoss: () => Number.NaN,
    };
    expect(await optimise(database.db, userId, now, fitter)).toEqual({
      kind: "skipped",
      reason: "too-few-reviews",
      reviewCount,
    });
    const [row] = await database.db
      .select()
      .from(fsrsParameters)
      .where(eq(fsrsParameters.userId, userId));
    expect(row).toBeUndefined();
  });

  test("the retention setting reaches the learner's schedulers", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 5004 });
    expect((await fsrsFor(database.db, user.id)).parameters.request_retention).toBe(0.9);

    await updateSettings(database.db, user.id, { desiredRetention: 85 });
    const words = await fsrsFor(database.db, user.id);
    const topics = await fsrsFor(database.db, user.id, { shortTerm: false });
    expect(words.parameters.request_retention).toBe(0.85);
    expect(topics.parameters.request_retention).toBe(0.85);
    expect(topics.parameters.enable_short_term).toBe(false);

    const card = topics.next(createEmptyCard(start), start, Rating.Good).card;
    await updateSettings(database.db, user.id, { desiredRetention: 95 });
    const at95 = await fsrsFor(database.db, user.id, { shortTerm: false });
    expect(topics.next(card, card.due, Rating.Good).card.scheduled_days).toBeGreaterThan(
      at95.next(card, card.due, Rating.Good).card.scheduled_days,
    );
  });

  test("the database refuses a retention outside 85..95", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 5005 });
    await expect(updateSettings(database.db, user.id, { desiredRetention: 99 })).rejects.toThrow();
  });
});
