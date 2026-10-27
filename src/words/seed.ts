import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { cefrLevelEnum, OWNER_LIST_SOURCE, words } from "../db/schema";

const CSV_HEADER = "lemma,pos,cefr_level,frequency_rank";
const BATCH_SIZE = 1000;

export const wordRowSchema = z.object({
  lemma: z.string().min(1),
  pos: z.string().min(1),
  cefrLevel: z.enum(cefrLevelEnum.enumValues),
  frequencyRank: z.number().int().positive().nullable(),
});
export type WordRow = z.infer<typeof wordRowSchema>;

/** Parses `data/words/words.csv`; every row is validated, a malformed file throws. */
export function parseWordsCsv(text: string): WordRow[] {
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (header !== CSV_HEADER) throw new Error(`unexpected words.csv header: ${header}`);

  return lines.map((line, index) => {
    const [lemma, pos, cefrLevel, rank, ...extra] = line.split(",");
    const parsed = wordRowSchema.safeParse({
      lemma,
      pos,
      cefrLevel,
      frequencyRank: rank ? Number(rank) : null,
    });
    if (!parsed.success || extra.length > 0) {
      throw new Error(`invalid words.csv row ${index + 2}: ${line}`);
    }
    return parsed.data;
  });
}

/** Levels C1 and above come from the Octanove list, the rest from CEFR-J (see data/words/README.md). */
function sourceFor(level: WordRow["cefrLevel"]): string {
  return level === "C1" || level === "C2" ? "octanove-c1c2-1.0" : "cefr-j-1.5";
}

/**
 * Idempotent upsert on (lemma, pos); returns the number of rows in the file. A lemma the owner's
 * list covers is left as the import wrote it: the import may have changed its part of speech, so
 * a seed row for it would come back as a duplicate.
 */
export async function seedWords(db: Db, rows: WordRow[]): Promise<number> {
  const owned = new Set(
    (
      await db
        .selectDistinct({ lemma: words.lemma })
        .from(words)
        .where(eq(words.source, OWNER_LIST_SOURCE))
    ).map((row) => row.lemma),
  );
  const seeded = rows.filter((row) => !owned.has(row.lemma));
  for (let start = 0; start < seeded.length; start += BATCH_SIZE) {
    const batch = seeded.slice(start, start + BATCH_SIZE).map((row) => ({
      lemma: row.lemma,
      pos: row.pos,
      cefrLevel: row.cefrLevel,
      frequencyRank: row.frequencyRank,
      source: sourceFor(row.cefrLevel),
    }));
    await db
      .insert(words)
      .values(batch)
      .onConflictDoUpdate({
        target: [words.lemma, words.pos],
        set: {
          cefrLevel: sql`excluded.cefr_level`,
          frequencyRank: sql`excluded.frequency_rank`,
          source: sql`excluded.source`,
        },
      });
  }
  return rows.length;
}
