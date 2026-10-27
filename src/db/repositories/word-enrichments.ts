import { and, asc, eq, inArray, notExists, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  type CefrLevel,
  type Language,
  OWNER_LIST_SOURCE,
  userSettings,
  users,
  type Word,
  type WordEnrichmentData,
  wordEnrichments,
  words,
} from "../schema";

/** The cached card back of a word in one language, if prefetch got to it. */
export async function getWordEnrichment(
  db: Db,
  wordId: number,
  lang: Language,
): Promise<WordEnrichmentData | undefined> {
  const [row] = await db
    .select({ data: wordEnrichments.data })
    .from(wordEnrichments)
    .where(and(eq(wordEnrichments.wordId, wordId), eq(wordEnrichments.lang, lang)));
  return row?.data;
}

const notCachedIn = (db: Db, lang: Language) =>
  notExists(
    db
      .select({ one: sql`1` })
      .from(wordEnrichments)
      .where(and(eq(wordEnrichments.wordId, words.id), eq(wordEnrichments.lang, lang))),
  );

/** Ids among `wordIds` with no cached enrichment in `lang`. */
export async function uncachedWordIds(
  db: Db,
  wordIds: number[],
  lang: Language,
): Promise<Set<number>> {
  if (!wordIds.length) return new Set();
  const rows = await db
    .select({ id: words.id })
    .from(words)
    .where(and(inArray(words.id, wordIds), notCachedIn(db, lang)));
  return new Set(rows.map((row) => row.id));
}

/** Stores enrichments; a row another job wrote in the meantime is kept. Returns rows written. */
export async function saveWordEnrichments(
  db: Db,
  rows: { wordId: number; lang: Language; data: WordEnrichmentData }[],
): Promise<number> {
  if (!rows.length) return 0;
  const written = await db
    .insert(wordEnrichments)
    .values(rows)
    .onConflictDoNothing()
    .returning({ wordId: wordEnrichments.wordId });
  return written.length;
}

/** Up to `limit` owner-list words with no enrichment in `lang`, in curriculum order. */
export async function ownerWordsWithoutEnrichment(
  db: Db,
  lang: Language,
  limit: number,
): Promise<Word[]> {
  if (limit <= 0) return [];
  return db
    .select()
    .from(words)
    .where(and(eq(words.source, OWNER_LIST_SOURCE), notCachedIn(db, lang)))
    .orderBy(asc(words.curriculumStage), asc(words.curriculumIndex), asc(words.id))
    .limit(limit);
}

export type PrefetchLearner = {
  userId: number;
  explainLang: Language;
  cefrLevel: CefrLevel | null;
  wordsPerDay: number;
};

/**
 * Learners the bot serves — allowed, or admins (`ADMIN_TELEGRAM_IDS` are admins by env, not by a
 * flag in the database) — who have settings.
 */
export async function listPrefetchLearners(
  db: Db,
  adminTelegramIds: readonly number[] = [],
): Promise<PrefetchLearner[]> {
  return db
    .select({
      userId: userSettings.userId,
      explainLang: userSettings.explainLang,
      cefrLevel: userSettings.cefrLevel,
      wordsPerDay: userSettings.wordsPerDay,
    })
    .from(userSettings)
    .innerJoin(users, eq(users.id, userSettings.userId))
    .where(
      or(
        eq(users.isAllowed, true),
        eq(users.isAdmin, true),
        adminTelegramIds.length ? inArray(users.telegramId, [...adminTelegramIds]) : undefined,
      ),
    )
    .orderBy(asc(userSettings.userId));
}
