import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { type WordImageRow, wordImages } from "../schema";

export type WordImageValues = Omit<WordImageRow, "fetchedAt">;

/** The stored picture of a word, or the record that its search found nothing. */
export async function getWordImage(db: Db, wordId: number): Promise<WordImageRow | undefined> {
  const [row] = await db.select().from(wordImages).where(eq(wordImages.wordId, wordId));
  return row;
}

/** Stores the picture a word now shows: the first fetch, or the learner's "another picture". */
export async function saveWordImage(
  db: Db,
  values: WordImageValues,
  now = new Date(),
): Promise<WordImageRow> {
  const row = { ...values, fetchedAt: now };
  const [saved] = await db
    .insert(wordImages)
    .values(row)
    .onConflictDoUpdate({ target: wordImages.wordId, set: row })
    .returning();
  if (!saved) throw new Error("word image not saved");
  return saved;
}
