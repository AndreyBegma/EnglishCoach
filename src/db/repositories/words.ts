import { and, asc, eq, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../client";
import {
  type CefrLevel,
  cards,
  excludedLemmas,
  OWNER_LIST_SOURCE,
  type Word,
  words,
} from "../schema";

const ownerWords = alias(words, "owner_words");

/**
 * Up to `limit` words of one CEFR level that the user has no card for (a known word has one too):
 * the owner's list first in curriculum order, then the rest most frequent first. Removed lemmas
 * are skipped, and so is a seed row whose lemma the owner's list already covers. Words without a
 * frequency rank come last; the id breaks ties so the order is deterministic.
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
        notExists(
          db
            .select({ one: sql`1` })
            .from(excludedLemmas)
            .where(eq(excludedLemmas.lemma, words.lemma)),
        ),
        or(
          eq(words.source, OWNER_LIST_SOURCE),
          notExists(
            db
              .select({ one: sql`1` })
              .from(ownerWords)
              .where(
                and(eq(ownerWords.lemma, words.lemma), eq(ownerWords.source, OWNER_LIST_SOURCE)),
              ),
          ),
        ),
      ),
    )
    .orderBy(
      sql`${words.curriculumStage} asc nulls last`,
      sql`${words.curriculumIndex} asc nulls last`,
      sql`${words.frequencyRank} asc nulls last`,
      asc(words.id),
    )
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
