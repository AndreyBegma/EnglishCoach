import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { words } from "../db/schema";
import { type PronunciationSources, pronounce } from "./pronunciation";

export type PronunciationImportResult = {
  total: number;
  updated: number;
  withUs: number;
  withUk: number;
  withSyllables: number;
};

/**
 * Fills `ipa_us`, `ipa_uk`, `syllables` and `stress_index` of every word from the dictionary
 * sources. Idempotent: a row whose values already match is not written, and a value no source
 * has any more is cleared. The owner's `ipa` is never touched.
 */
export async function importPronunciation(
  db: Db,
  sources: PronunciationSources,
): Promise<PronunciationImportResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: words.id,
        lemma: words.lemma,
        ipaUs: words.ipaUs,
        ipaUk: words.ipaUk,
        syllables: words.syllables,
        stressIndex: words.stressIndex,
      })
      .from(words);
    const result: PronunciationImportResult = {
      total: rows.length,
      updated: 0,
      withUs: 0,
      withUk: 0,
      withSyllables: 0,
    };
    for (const row of rows) {
      const next = pronounce(row.lemma, sources);
      if (next.ipaUs) result.withUs++;
      if (next.ipaUk) result.withUk++;
      if (next.syllables) result.withSyllables++;
      if (
        next.ipaUs === row.ipaUs &&
        next.ipaUk === row.ipaUk &&
        next.syllables === row.syllables &&
        next.stressIndex === row.stressIndex
      ) {
        continue;
      }
      await tx.update(words).set(next).where(eq(words.id, row.id));
      result.updated++;
    }
    return result;
  });
}
