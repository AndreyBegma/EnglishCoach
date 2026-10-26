import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import {
  applyReview,
  countDueSince,
  countKnownWords,
  createCard,
  findNextDueCard,
  findPendingCard,
  findWordCardByFront,
  getCard,
  markCardKnown,
  reviewStatsSince,
  unmarkCardKnown,
} from "../../src/db/repositories/cards";
import { countDueCards as countDueCount } from "../../src/db/repositories/hub";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { reviewLogs, words } from "../../src/db/schema";
import { Scheduler } from "../../src/vocab/scheduler";
import { addVocabStats, newWordsOn } from "../../src/vocab/stats";
import { createTestDatabase, testServerUrl } from "./test-database";

describe.skipIf(!testServerUrl)("cards repository", () => {
  let database: Database;
  const scheduler = new Scheduler();
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  const newCard = (userId: number, front: string, at: Date, extra: { wordId?: number } = {}) =>
    createCard(database.db, {
      userId,
      itemType: extra.wordId ? "word" : "user_word",
      front,
      back: { translation: `${front}-t` },
      fsrs: scheduler.newCard(at),
      ...extra,
    });

  async function rate(cardId: number, userId: number, rating: "again" | "good", at: Date) {
    const card = await getCard(database.db, userId, cardId);
    if (!card) throw new Error("no card");
    const { next, log } = scheduler.rate(card, rating, at);
    return applyReview(database.db, card.id, card.reps, next, log);
  }

  test("a dictionary word gets one card per user; the second create returns the first", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 8101 });
    const [word] = await database.db
      .insert(words)
      .values({ lemma: "decide", pos: "verb", cefrLevel: "A2", source: "test" })
      .returning();
    if (!word) throw new Error("no word");
    const at = new Date("2026-10-26T08:00:00Z");
    const first = await newCard(user.id, "decide", at, { wordId: word.id });
    const second = await newCard(user.id, "decide", at, { wordId: word.id });
    expect(second.id).toBe(first.id);
  });

  test("pending cards: the oldest unrated word card, gone once it is rated", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 8102 });
    const at = new Date("2026-10-26T08:00:00Z");
    const a = await newCard(user.id, "alpha", at);
    await newCard(user.id, "beta", at);
    expect((await findPendingCard(database.db, user.id))?.id).toBe(a.id);

    expect(await rate(a.id, user.id, "good", at)).toBe(true);
    expect((await findPendingCard(database.db, user.id))?.front).toBe("beta");
    expect((await findWordCardByFront(database.db, user.id, "ALPHA"))?.id).toBe(a.id);
  });

  test("a known word is not pending, not due, not counted; unmarking restores it", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 8110 });
    const other = await getOrCreateUser(database.db, { telegramId: 8111 });
    const at = new Date("2026-10-26T08:00:00Z");
    const later = new Date("2026-10-27T08:00:00Z");
    const pending = await newCard(user.id, "house", at);
    const rated = await newCard(user.id, "table", at);
    await rate(rated.id, user.id, "good", at);
    const since = new Date("2026-10-27T00:00:00Z");

    expect(await countDueSince(database.db, user.id, later, since)).toBe(1);
    expect(await markCardKnown(database.db, other.id, pending.id, at)).toBe(false);
    expect(await markCardKnown(database.db, user.id, pending.id, at)).toBe(true);
    expect(await markCardKnown(database.db, user.id, pending.id, at)).toBe(false);
    expect(await markCardKnown(database.db, user.id, rated.id, at)).toBe(true);

    expect(await findPendingCard(database.db, user.id)).toBeUndefined();
    expect(await findNextDueCard(database.db, user.id, later, since)).toBeUndefined();
    expect(await countDueSince(database.db, user.id, later, since)).toBe(0);
    expect(await countDueCount(database.db, user.id, later)).toBe(0);
    expect(await countKnownWords(database.db, user.id)).toBe(2);

    expect(await unmarkCardKnown(database.db, user.id, pending.id)).toBe(true);
    expect(await unmarkCardKnown(database.db, user.id, pending.id)).toBe(false);
    expect((await findPendingCard(database.db, user.id))?.id).toBe(pending.id);
    expect(await countDueCount(database.db, user.id, later)).toBe(0);
    await unmarkCardKnown(database.db, user.id, rated.id);
    expect(await countDueCount(database.db, user.id, later)).toBe(1);
  });

  test("applyReview writes the card and its log once; a repeat with stale reps is refused", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 8103 });
    const at = new Date("2026-10-26T08:00:00Z");
    const card = await newCard(user.id, "gamma", at);
    const { next, log } = scheduler.rate(card, "good", at);

    expect(await applyReview(database.db, card.id, card.reps, next, log)).toBe(true);
    expect(await applyReview(database.db, card.id, card.reps, next, log)).toBe(false);

    const logs = await database.db.select().from(reviewLogs).where(eq(reviewLogs.cardId, card.id));
    expect(logs).toHaveLength(1);
    expect((await getCard(database.db, user.id, card.id))?.reps).toBe(1);
  });

  test("next due card: earliest due, reviewable only, not twice in one session", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 8104 });
    const learnedAt = new Date("2026-10-20T08:00:00Z");
    const later = await newCard(user.id, "later", learnedAt);
    const sooner = await newCard(user.id, "sooner", learnedAt);
    await newCard(user.id, "pending", learnedAt);
    await rate(later.id, user.id, "good", new Date("2026-10-20T09:00:00Z"));
    await rate(sooner.id, user.id, "good", learnedAt);

    const sessionStart = new Date("2026-10-26T08:00:00Z");
    expect(await countDueSince(database.db, user.id, sessionStart, sessionStart)).toBe(2);
    const first = await findNextDueCard(database.db, user.id, sessionStart, sessionStart);
    expect(first?.id).toBe(sooner.id);

    // Rated Again it is due again in minutes, but not again in this session.
    const reviewAt = new Date("2026-10-26T08:01:00Z");
    await rate(sooner.id, user.id, "again", reviewAt);
    const afterReview = new Date("2026-10-26T09:00:00Z");
    const second = await findNextDueCard(database.db, user.id, afterReview, sessionStart);
    expect(second?.id).toBe(later.id);
    expect(await countDueSince(database.db, user.id, afterReview, sessionStart)).toBe(1);

    const stats = await reviewStatsSince(database.db, user.id, sessionStart);
    expect(stats).toEqual({ learned: 0, reviewed: 1, passed: 0 });
    expect(await reviewStatsSince(database.db, user.id, learnedAt)).toEqual({
      learned: 2,
      reviewed: 1,
      passed: 2,
    });
  });

  test("other users' cards are invisible", async () => {
    const owner = await getOrCreateUser(database.db, { telegramId: 8105 });
    const other = await getOrCreateUser(database.db, { telegramId: 8106 });
    const card = await newCard(owner.id, "private", new Date("2026-10-26T08:00:00Z"));
    expect(await getCard(database.db, other.id, card.id)).toBeUndefined();
    expect(await findPendingCard(database.db, other.id)).toBeUndefined();
  });

  test("daily vocabulary counters add up per learner day", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 8107 });
    await addVocabStats(database.db, user.id, "2026-10-26", { newWords: 1 });
    await addVocabStats(database.db, user.id, "2026-10-26", { newWords: 1, reviews: 3 });
    await addVocabStats(database.db, user.id, "2026-10-27", { reviews: 1 });
    expect(await newWordsOn(database.db, user.id, "2026-10-26")).toBe(2);
    expect(await newWordsOn(database.db, user.id, "2026-10-27")).toBe(0);
  });
});
