import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { upsertMistake } from "../../src/db/repositories/mistakes";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { cards } from "../../src/db/schema";
import { GRAMMAR_CARD_THRESHOLD, promoteMistakeToCard } from "../../src/grammar";
import { createTestDatabase, testServerUrl } from "../db/test-database";

describe.skipIf(!testServerUrl)("mistake → card promotion", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  const input = {
    category: "grammar" as const,
    pattern: "present perfect with since",
    exampleWrong: "I live here since 2019",
    exampleRight: "I have lived here since 2019",
    explanation: "Use the present perfect with since.",
  };

  test("the threshold is two sightings", () => {
    expect(GRAMMAR_CARD_THRESHOLD).toBe(2);
  });

  test("a pattern seen once stays a mistake; the second sighting makes one card; later ones add none", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 710_001 });
    const userCards = () => database.db.select().from(cards).where(eq(cards.userId, user.id));

    const first = await upsertMistake(database.db, user.id, input);
    expect(first.count).toBe(1);
    expect(await promoteMistakeToCard(database.db, first)).toBeNull();
    expect(await userCards()).toHaveLength(0);

    const second = await upsertMistake(database.db, user.id, input);
    expect(second.count).toBe(2);
    const cardId = await promoteMistakeToCard(database.db, second);
    expect(cardId).not.toBeNull();
    const [card] = await userCards();
    expect(card).toMatchObject({
      id: cardId,
      itemType: "grammar_pattern",
      front: "present perfect with since",
      wordId: null,
      state: 0,
      reps: 0,
    });
    expect(card?.backJson).toEqual({
      translation: "Use the present perfect with since.",
      examples: ["I have lived here since 2019"],
    });

    const third = await upsertMistake(database.db, user.id, input);
    expect(third.count).toBe(3);
    expect(third.cardId).toBe(cardId);
    expect(await promoteMistakeToCard(database.db, third)).toBeNull();
    // A stale row (read before the card existed) cannot create a second one either.
    expect(await promoteMistakeToCard(database.db, { ...second, count: 3 })).toBeNull();
    expect(await userCards()).toHaveLength(1);
  });

  test("two concurrent promotions of the same mistake create one card", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 710_002 });
    await upsertMistake(database.db, user.id, input);
    const row = await upsertMistake(database.db, user.id, input);

    const results = await Promise.all([
      promoteMistakeToCard(database.db, row),
      promoteMistakeToCard(database.db, row),
    ]);
    expect(results.filter((id) => id !== null)).toHaveLength(1);
    expect(await database.db.select().from(cards).where(eq(cards.userId, user.id))).toHaveLength(1);
  });
});
