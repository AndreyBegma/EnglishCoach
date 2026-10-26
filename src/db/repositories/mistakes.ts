import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type Mistake, mistakes } from "../schema";

const MAX_PATTERN_LENGTH = 120;

/**
 * Groups spellings of the same error label: lowercased, quotes and stray punctuation dropped,
 * whitespace collapsed, capped in length. The result is the `mistakes.pattern` key.
 */
export function normaliseMistakePattern(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/["'`“”‘’«»]/g, "")
    .replace(/[^\p{L}\p{N}\s/+→-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PATTERN_LENGTH)
    .trim();
}

export type MistakeInput = Pick<Mistake, "category" | "exampleWrong" | "exampleRight"> & {
  /** Raw label; normalised here, so callers never build the key themselves. */
  pattern: string;
  explanation: string;
};

/**
 * Records one occurrence of an error pattern: inserts the row, or counts up the existing one for
 * (user, category, normalised pattern) and refreshes its examples. Returns the row.
 */
export async function upsertMistake(db: Db, userId: number, input: MistakeInput): Promise<Mistake> {
  const pattern = normaliseMistakePattern(input.pattern);
  if (!pattern) throw new Error("mistake pattern is empty after normalisation");

  const [row] = await db
    .insert(mistakes)
    .values({
      userId,
      category: input.category,
      pattern,
      exampleWrong: input.exampleWrong,
      exampleRight: input.exampleRight,
      explanation: input.explanation,
    })
    .onConflictDoUpdate({
      target: [mistakes.userId, mistakes.category, mistakes.pattern],
      set: {
        count: sql`${mistakes.count} + 1`,
        lastSeenAt: sql`now()`,
        exampleWrong: input.exampleWrong,
        exampleRight: input.exampleRight,
        explanation: input.explanation,
      },
    })
    .returning();
  if (!row) throw new Error("upsert of mistakes returned no row");
  return row;
}

/**
 * The user's `limit` weakest spots: the most repeated mistake patterns first, the most recently
 * seen breaking ties, then the id so the order is deterministic.
 */
export async function listTopMistakes(db: Db, userId: number, limit: number): Promise<Mistake[]> {
  if (limit <= 0) return [];
  return db
    .select()
    .from(mistakes)
    .where(eq(mistakes.userId, userId))
    .orderBy(desc(mistakes.count), desc(mistakes.lastSeenAt), desc(mistakes.id))
    .limit(limit);
}
