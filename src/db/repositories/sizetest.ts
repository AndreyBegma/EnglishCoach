import { and, desc, eq, notExists, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  excludedLemmas,
  type Language,
  type SizeTestAnswer,
  type SizeTestBand,
  type SizeTestItem,
  type VocabSizeTestRow,
  vocabSizeTests,
  wordEnrichments,
  words,
} from "../schema";

/** A dictionary word the size test can ask: its meaning in the learner's explanation language. */
export interface SizeTestCandidate {
  wordId: number;
  lemma: string;
  meaning: string;
}

/**
 * Up to `limit` random single words with a frequency rank in `[fromRank, toRank]` and a meaning in
 * `lang`: the shared enrichment cache's translation, or for `ru` the owner's `translation_ru`.
 * Removed lemmas are skipped. Our own data only; nothing here calls a model.
 */
export async function sizeTestCandidates(
  db: Db,
  lang: Language,
  fromRank: number,
  toRank: number,
  limit: number,
): Promise<SizeTestCandidate[]> {
  if (limit <= 0) return [];
  const cached = sql<string | null>`nullif(trim(${wordEnrichments.data}->>'translation'), '')`;
  const meaning =
    lang === "ru"
      ? sql<string | null>`coalesce(${cached}, nullif(trim(${words.translationRu}), ''))`
      : cached;
  const rows = await db
    .select({ wordId: words.id, lemma: words.lemma, meaning })
    .from(words)
    .leftJoin(
      wordEnrichments,
      and(eq(wordEnrichments.wordId, words.id), eq(wordEnrichments.lang, lang)),
    )
    .where(
      and(
        eq(words.unitType, "word"),
        sql`${words.frequencyRank} between ${fromRank} and ${toRank}`,
        sql`${meaning} is not null`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(excludedLemmas)
            .where(eq(excludedLemmas.lemma, words.lemma)),
        ),
      ),
    )
    .orderBy(sql`random()`)
    .limit(limit);
  return rows.flatMap((row) => (row.meaning ? [{ ...row, meaning: row.meaning }] : []));
}

export interface FinishedSizeTest {
  userId: number;
  sessionId: number | null;
  items: SizeTestItem[];
  answers: SizeTestAnswer[];
  startedAt: Date;
  finishedAt: Date;
  estimate: number;
  coverageBp: number;
  bands: SizeTestBand[];
  falseAlarmsBp: number;
}

/** Stores a finished test: one row of the learner's size history. */
export async function insertSizeTest(db: Db, test: FinishedSizeTest): Promise<void> {
  await db.insert(vocabSizeTests).values(test);
}

/** The learner's finished tests, newest first. */
export async function listSizeTests(
  db: Db,
  userId: number,
  limit: number,
): Promise<VocabSizeTestRow[]> {
  return db
    .select()
    .from(vocabSizeTests)
    .where(eq(vocabSizeTests.userId, userId))
    .orderBy(desc(vocabSizeTests.finishedAt))
    .limit(limit);
}
