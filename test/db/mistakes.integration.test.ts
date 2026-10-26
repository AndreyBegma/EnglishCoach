import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import { listTopMistakes } from "../../src/db/repositories/mistakes";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { mistakes } from "../../src/db/schema";
import { createTestDatabase, testServerUrl } from "./test-database";

describe.skipIf(!testServerUrl)("mistakes repository", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  test("lists the most repeated patterns first, recency breaking ties, only the user's own", async () => {
    const alice = await getOrCreateUser(database.db, { telegramId: 2001 });
    const bob = await getOrCreateUser(database.db, { telegramId: 2002 });
    const row = (userId: number, pattern: string, count: number, lastSeenAt: string) => ({
      userId,
      category: "grammar" as const,
      pattern,
      exampleWrong: "x",
      exampleRight: "y",
      explanation: "z",
      count,
      lastSeenAt: new Date(lastSeenAt),
    });
    await database.db
      .insert(mistakes)
      .values([
        row(alice.id, "articles", 2, "2026-10-01"),
        row(alice.id, "present perfect", 5, "2026-09-01"),
        row(alice.id, "prepositions", 2, "2026-10-20"),
        row(alice.id, "plural", 1, "2026-10-25"),
        row(bob.id, "bob only", 9, "2026-10-25"),
      ]);

    const top = await listTopMistakes(database.db, alice.id, 3);
    expect(top.map((m) => m.pattern)).toEqual(["present perfect", "prepositions", "articles"]);
    expect(await listTopMistakes(database.db, alice.id, 0)).toEqual([]);
  });
});
