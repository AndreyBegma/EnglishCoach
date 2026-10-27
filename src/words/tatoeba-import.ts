import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { exampleSentences, exampleSentenceWords, TATOEBA_SOURCE, words } from "../db/schema";
import {
  buildTatoebaExamples,
  DEFAULT_FILTER,
  type ExampleFilter,
  linesOf,
  TATOEBA_FILES,
  type TatoebaSources,
} from "./tatoeba";

export type TatoebaImportResult = {
  scanned: number;
  passed: number;
  sentences: number;
  inserted: number;
  removed: number;
  links: number;
  /** Dictionary words with at least one example. */
  words: number;
};

/** Rows per insert statement: well under Postgres's 65535 bind parameters. */
const CHUNK = 1000;

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < list.length; start += size) out.push(list.slice(start, start + size));
  return out;
}

/** The export files of a directory, read line by line. */
export function tatoebaSourcesFrom(dir: string): TatoebaSources {
  const lines = (name: string) => linesOf(Bun.file(`${dir}/${name}`).stream());
  return {
    english: lines(TATOEBA_FILES.english),
    sentences: { ru: lines(TATOEBA_FILES.sentences.ru), uk: lines(TATOEBA_FILES.sentences.uk) },
    links: { ru: lines(TATOEBA_FILES.links.ru), uk: lines(TATOEBA_FILES.links.uk) },
  };
}

/**
 * Imports Tatoeba example sentences for the dictionary's words. Idempotent: in one transaction it
 * upserts the chosen sentences by their Tatoeba id, removes the Tatoeba sentences no longer chosen,
 * and rewrites their lemma links. Run after `db:seed` and `db:import:owner-words`, so the owner's
 * words get examples too.
 */
export async function importTatoeba(
  db: Db,
  sources: TatoebaSources,
  filter: ExampleFilter = DEFAULT_FILTER,
): Promise<TatoebaImportResult> {
  const dictionary = await db
    .select({ id: words.id, lemma: words.lemma, cefrLevel: words.cefrLevel })
    .from(words);
  const built = await buildTatoebaExamples(sources, dictionary, filter);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ sourceId: exampleSentences.sourceId })
      .from(exampleSentences)
      .where(eq(exampleSentences.source, TATOEBA_SOURCE));
    const before = new Set(existing.map((row) => row.sourceId));
    const chosen = new Set(built.candidates.map((candidate) => candidate.sourceId));
    const stale = [...before].filter((id) => !chosen.has(id));
    for (const ids of chunks(stale)) {
      await tx
        .delete(exampleSentences)
        .where(
          and(eq(exampleSentences.source, TATOEBA_SOURCE), inArray(exampleSentences.sourceId, ids)),
        );
    }

    const idOf = new Map<number, number>();
    for (const part of chunks(built.candidates)) {
      const rows = await tx
        .insert(exampleSentences)
        .values(
          part.map((candidate) => ({
            source: TATOEBA_SOURCE,
            sourceId: candidate.sourceId,
            text: candidate.text,
            cefrLevel: candidate.cefrLevel,
            wordCount: candidate.wordCount,
            author: candidate.author,
            translations: candidate.translations,
          })),
        )
        .onConflictDoUpdate({
          target: [exampleSentences.source, exampleSentences.sourceId],
          set: {
            text: sql`excluded.text`,
            cefrLevel: sql`excluded.cefr_level`,
            wordCount: sql`excluded.word_count`,
            author: sql`excluded.author`,
            translations: sql`excluded.translations`,
          },
        })
        .returning({ id: exampleSentences.id, sourceId: exampleSentences.sourceId });
      for (const row of rows) idOf.set(row.sourceId, row.id);
    }

    const sentenceIds = [...idOf.values()];
    for (const ids of chunks(sentenceIds)) {
      await tx.delete(exampleSentenceWords).where(inArray(exampleSentenceWords.sentenceId, ids));
    }
    const links = built.candidates.flatMap((candidate) => {
      const sentenceId = idOf.get(candidate.sourceId);
      return sentenceId === undefined
        ? []
        : candidate.wordIds.map((wordId) => ({ wordId, sentenceId }));
    });
    for (const part of chunks(links)) await tx.insert(exampleSentenceWords).values(part);

    return {
      scanned: built.scanned,
      passed: built.passed,
      sentences: built.candidates.length,
      inserted: built.candidates.filter((candidate) => !before.has(candidate.sourceId)).length,
      removed: stale.length,
      links: links.length,
      words: new Set(links.map((link) => link.wordId)).size,
    };
  });
}
