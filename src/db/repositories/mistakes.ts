import { desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type Mistake, mistakes } from "../schema";

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
