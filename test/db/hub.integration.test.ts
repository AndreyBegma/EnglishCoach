import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEmptyCard } from "ts-fsrs";
import type { Database } from "../../src/db/client";
import { fsrsCardToColumns } from "../../src/db/fsrs";
import { countDueCards, deleteHub, getHub, saveHub } from "../../src/db/repositories/hub";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { cards } from "../../src/db/schema";
import { createTestDatabase, testServerUrl } from "./test-database";

describe.skipIf(!testServerUrl)("hub repository", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  test("saves, replaces and deletes the hub message", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 7001 });
    expect(await getHub(database.db, user.id)).toBeUndefined();

    await saveHub(database.db, { userId: user.id, chatId: 7001, messageId: 5, pinned: false });
    await saveHub(database.db, { userId: user.id, chatId: 7001, messageId: 9, pinned: true });
    expect(await getHub(database.db, user.id)).toEqual({
      userId: user.id,
      chatId: 7001,
      messageId: 9,
      pinned: true,
    });

    await deleteHub(database.db, user.id);
    expect(await getHub(database.db, user.id)).toBeUndefined();
  });

  test("counts only the user's cards that are due", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 7002 });
    const other = await getOrCreateUser(database.db, { telegramId: 7003 });
    const now = new Date("2026-10-26T12:00:00Z");
    const card = (
      userId: number,
      due: string,
      itemType: "user_word" | "word" | "grammar_pattern" = "user_word",
      reps = 1,
    ) => ({
      userId,
      itemType,
      front: "word",
      ...fsrsCardToColumns(createEmptyCard(new Date(due))),
      reps,
    });
    await database.db
      .insert(cards)
      .values([
        card(user.id, "2026-10-25T00:00:00Z"),
        card(user.id, "2026-10-26T12:00:00Z"),
        card(user.id, "2026-10-27T00:00:00Z"),
        card(other.id, "2026-10-01T00:00:00Z"),
      ]);

    expect(await countDueCards(database.db, user.id, now)).toBe(2);
  });

  test("pending Learn-words cards are not due; new grammar-pattern cards are", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 7004 });
    const now = new Date("2026-10-26T12:00:00Z");
    const fresh = fsrsCardToColumns(createEmptyCard(new Date("2026-10-25T00:00:00Z")));
    await database.db.insert(cards).values([
      { userId: user.id, itemType: "word", front: "pending", ...fresh },
      { userId: user.id, itemType: "user_word", front: "pending too", ...fresh },
      { userId: user.id, itemType: "grammar_pattern", front: "a pattern", ...fresh },
    ]);

    expect(await countDueCards(database.db, user.id, now)).toBe(1);
  });
});
