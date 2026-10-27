import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { type CardRow, words } from "../db/schema";
import { formatSyllables } from "../words/ipa";
import { wordIpa } from "../words/pronunciation";
import type { Pronunciation } from "./render";

/**
 * What a dictionary word's card shows of its pronunciation for the learner's variant. Empty
 * stays empty: a word without a dictionary value, or a card without a word, gets none.
 */
export async function pronunciationFor(
  db: Db,
  card: Pick<CardRow, "wordId">,
  variant: "us" | "uk",
): Promise<Pronunciation | undefined> {
  if (!card.wordId) return undefined;
  const [word] = await db
    .select({
      ipa: words.ipa,
      ipaUs: words.ipaUs,
      ipaUk: words.ipaUk,
      syllables: words.syllables,
      stressIndex: words.stressIndex,
    })
    .from(words)
    .where(eq(words.id, card.wordId));
  if (!word) return undefined;
  return {
    ipa: wordIpa(word, variant),
    syllables: word.syllables ? formatSyllables(word.syllables, word.stressIndex) : null,
  };
}
