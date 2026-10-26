import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createEmptyCard, fsrs, Rating } from "ts-fsrs";
import type { Database } from "../../src/db/client";
import {
  columnsToFsrsCard,
  columnsToFsrsReviewLog,
  fsrsCardToColumns,
  fsrsReviewLogToColumns,
} from "../../src/db/fsrs";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { cards, reviewLogs } from "../../src/db/schema";
import { createTestDatabase, testServerUrl } from "./test-database";

describe.skipIf(!testServerUrl)("FSRS columns round-trip through Postgres", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  test("a new card and a reviewed card come back equal to the ts-fsrs Card", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 3001 });
    const scheduler = fsrs();
    const fresh = createEmptyCard(new Date("2026-10-01T08:30:00.123Z"));
    // Two reviews so stability/difficulty are non-trivial floats and last_review is set.
    const first = scheduler.next(fresh, new Date("2026-10-01T08:31:00Z"), Rating.Good);
    const second = scheduler.next(first.card, new Date("2026-10-03T19:00:00Z"), Rating.Hard);

    for (const card of [fresh, second.card]) {
      const [inserted] = await database.db
        .insert(cards)
        .values({
          userId: user.id,
          itemType: "user_word",
          front: "serendipity",
          ...fsrsCardToColumns(card),
        })
        .returning({ id: cards.id });
      if (!inserted) throw new Error("insert returned no row");

      const [row] = await database.db.select().from(cards).where(eq(cards.id, inserted.id));
      if (!row) throw new Error("card not found");
      expect(columnsToFsrsCard(row)).toEqual(card);
    }
  });

  test("a review log comes back equal to the ts-fsrs ReviewLog", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 3002 });
    const { card, log } = fsrs().next(
      createEmptyCard(new Date("2026-10-01T08:30:00Z")),
      new Date("2026-10-02T09:45:12.345Z"),
      Rating.Again,
    );
    const [cardRow] = await database.db
      .insert(cards)
      .values({
        userId: user.id,
        itemType: "grammar_pattern",
        front: "since vs for",
        ...fsrsCardToColumns(card),
      })
      .returning({ id: cards.id });
    if (!cardRow) throw new Error("insert returned no row");

    await database.db
      .insert(reviewLogs)
      .values({ cardId: cardRow.id, ...fsrsReviewLogToColumns(log) });
    const [row] = await database.db
      .select()
      .from(reviewLogs)
      .where(eq(reviewLogs.cardId, cardRow.id));
    if (!row) throw new Error("review log not found");

    expect(columnsToFsrsReviewLog(row)).toEqual(log);
  });
});
