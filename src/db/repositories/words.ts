import { and, asc, eq, ne, notExists, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type CefrLevel, cards, type Word, words } from "../schema";

/**
 * Up to `limit` words of one CEFR level that the user has no card for, most frequent first.
 * Words without a frequency rank come last; the id breaks ties so the order is deterministic.
 */
export async function findUnseenWords(
  db: Db,
  userId: number,
  level: CefrLevel,
  limit: number,
): Promise<Word[]> {
  if (limit <= 0) return [];
  return db
    .select()
    .from(words)
    .where(
      and(
        eq(words.cefrLevel, level),
        notExists(
          db
            .select({ one: sql`1` })
            .from(cards)
            .where(and(eq(cards.userId, userId), eq(cards.wordId, words.id))),
        ),
      ),
    )
    .orderBy(sql`${words.frequencyRank} asc nulls last`, asc(words.id))
    .limit(limit);
}

/** Up to `limit` random lemmas of one level other than `exclude` — distractor material. */
export async function randomLemmas(
  db: Db,
  level: CefrLevel,
  exclude: string,
  limit: number,
): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ lemma: words.lemma })
    .from(words)
    .where(and(eq(words.cefrLevel, level), ne(words.lemma, exclude)))
    .orderBy(sql`random()`)
    .limit(limit);
  return rows.map((row) => row.lemma);
}
