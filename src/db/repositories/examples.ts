import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { rankFor } from "../../words/tatoeba";
import type { Db } from "../client";
import {
  type CefrLevel,
  type CreditedExample,
  exampleSentences,
  exampleSentenceWords,
  type Language,
  TATOEBA_SOURCE,
  words,
} from "../schema";

/**
 * Up to `perWord` human-written examples per word, translated into `lang`, best first: at or below
 * the word's level, then nearest a card's length. Each carries its Tatoeba credit. English has no
 * translations at the source, so for `en` the map is empty.
 */
export async function verifiedExamples(
  db: Db,
  wordIds: readonly number[],
  lang: Language,
  perWord = 2,
): Promise<Map<number, CreditedExample[]>> {
  const out = new Map<number, CreditedExample[]>();
  if (!wordIds.length || lang === "en") return out;
  const rows = await db
    .select({
      wordId: exampleSentenceWords.wordId,
      wordLevel: words.cefrLevel,
      sourceId: exampleSentences.sourceId,
      text: exampleSentences.text,
      author: exampleSentences.author,
      cefrLevel: exampleSentences.cefrLevel,
      wordCount: exampleSentences.wordCount,
      translation: sql<string>`${exampleSentences.translations} -> ${lang} ->> 'text'`,
    })
    .from(exampleSentenceWords)
    .innerJoin(exampleSentences, eq(exampleSentences.id, exampleSentenceWords.sentenceId))
    .innerJoin(words, eq(words.id, exampleSentenceWords.wordId))
    .where(
      and(
        inArray(exampleSentenceWords.wordId, [...wordIds]),
        eq(exampleSentences.source, TATOEBA_SOURCE),
        isNotNull(sql`${exampleSentences.translations} -> ${lang}`),
      ),
    );

  const byWord = new Map<number, typeof rows>();
  for (const row of rows) byWord.set(row.wordId, [...(byWord.get(row.wordId) ?? []), row]);
  for (const [wordId, list] of byWord) {
    const level: CefrLevel = list[0]?.wordLevel ?? "C2";
    const ranked = list.sort(rankFor(level)).slice(0, perWord);
    out.set(
      wordId,
      ranked.map((row) => ({
        en: row.text,
        translation: row.translation,
        credit: { source: TATOEBA_SOURCE, id: row.sourceId, author: row.author },
      })),
    );
  }
  return out;
}
