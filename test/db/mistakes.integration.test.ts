import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import {
  listTopMistakes,
  normaliseMistakePattern,
  upsertMistake,
} from "../../src/db/repositories/mistakes";
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

  test("upsert counts a pattern up across spellings of the same label", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 2003 });
    const base = {
      category: "grammar" as const,
      exampleWrong: "I have seen him yesterday",
      exampleRight: "I saw him yesterday",
      explanation: "Past simple with finished time.",
    };

    const first = await upsertMistake(database.db, user.id, {
      ...base,
      pattern: 'Present perfect with "yesterday"',
    });
    const second = await upsertMistake(database.db, user.id, {
      ...base,
      pattern: "  present PERFECT with yesterday. ",
      exampleWrong: "She has left yesterday",
    });
    const other = await upsertMistake(database.db, user.id, {
      ...base,
      category: "spelling",
      pattern: "present perfect with yesterday",
    });

    expect(first.count).toBe(1);
    expect(second).toMatchObject({
      id: first.id,
      count: 2,
      pattern: "present perfect with yesterday",
      exampleWrong: "She has left yesterday",
    });
    expect(other.id).not.toBe(first.id);
    expect(other.count).toBe(1);
  });

  test("upsert refuses a pattern that normalises to nothing", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 2004 });
    await expect(
      upsertMistake(database.db, user.id, {
        category: "grammar",
        pattern: " ?! ",
        exampleWrong: "x",
        exampleRight: "y",
        explanation: "z",
      }),
    ).rejects.toThrow("empty");
  });
});

describe("normaliseMistakePattern", () => {
  test("lowercases, strips quotes and punctuation, collapses whitespace", () => {
    expect(normaliseMistakePattern(`  Missing  article — before "singular" noun! `)).toBe(
      "missing article before singular noun",
    );
    expect(normaliseMistakePattern("a/an vs the")).toBe("a/an vs the");
  });

  test("caps the length", () => {
    expect(normaliseMistakePattern("x".repeat(500))).toHaveLength(120);
  });
});
