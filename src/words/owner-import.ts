import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { excludedLemmas, OWNER_LIST_SOURCE, type Word, words } from "../db/schema";
import type { OwnerList, OwnerWord } from "./owner-list";

const CHUNK = 1000;

/** A previously imported word the list no longer contains: kept for its cards, out of the curriculum. */
export const DROPPED_OWNER_SOURCE = "owner_list_dropped";

export type OwnerImportResult = {
  updated: number;
  inserted: number;
  dropped: number;
  removed: number;
};

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += CHUNK)
    out.push(items.slice(start, start + CHUNK));
  return out;
}

/**
 * The dictionary row an owner word lands on, so cards and the frequency rank stay attached: the
 * row that already has the final part of speech, else the owner row of an earlier import, else the
 * seed row for one of the owner's parts of speech, else the lemma's most frequent row.
 */
function targetRow(word: OwnerWord, finalPos: string | null, rows: Word[]): Word | undefined {
  const byRank = [...rows].sort(
    (a, b) =>
      (a.frequencyRank ?? Number.MAX_SAFE_INTEGER) - (b.frequencyRank ?? Number.MAX_SAFE_INTEGER) ||
      a.id - b.id,
  );
  return (
    (finalPos === null ? undefined : rows.find((row) => row.pos === finalPos)) ??
    rows.find((row) => row.source === OWNER_LIST_SOURCE) ??
    word.pos.map((pos) => rows.find((row) => row.pos === pos)).find(Boolean) ??
    byRank[0]
  );
}

const ownerFields = (word: OwnerWord, examples: boolean) => ({
  cefrLevel: word.cefrLevel,
  source: OWNER_LIST_SOURCE,
  topic: word.topic,
  ipa: word.ipa,
  ...(examples ? { example: word.example } : {}),
  translationRu: word.translationRu,
  curriculumStage: word.stage,
  curriculumIndex: word.index,
});

export type OwnerImportOptions = {
  /**
   * Write `example` (default). The committed seed has no examples (they are dictionary sentences
   * kept out of the repository), so loading it passes `false` and leaves the column as it is.
   */
  examples?: boolean;
};

/**
 * Overlays the owner's list on the dictionary in one transaction. Owner fields (level, part of
 * speech, IPA, translation, example, topic) win over the seed's; the seed's frequency rank stays.
 * The removed list replaces the owner's exclusions. Running it twice on the same list changes
 * nothing the second time.
 */
export async function importOwnerList(
  db: Db,
  list: OwnerList,
  { examples = true }: OwnerImportOptions = {},
): Promise<OwnerImportResult> {
  return db.transaction(async (tx) => {
    const lemmas = list.words.map((word) => word.lemma);
    const existing = new Map<string, Word[]>();
    for (const part of chunks(lemmas)) {
      for (const row of await tx.select().from(words).where(inArray(words.lemma, part))) {
        existing.set(row.lemma, [...(existing.get(row.lemma) ?? []), row]);
      }
    }

    const result: OwnerImportResult = { updated: 0, inserted: 0, dropped: 0, removed: 0 };
    const targets = new Set<number>();
    const inserts: (typeof words.$inferInsert)[] = [];
    for (const word of list.words) {
      const finalPos = word.pos.length ? word.pos.join(", ") : null;
      const target = targetRow(word, finalPos, existing.get(word.lemma) ?? []);
      if (!target) {
        inserts.push({ lemma: word.lemma, pos: finalPos ?? "", ...ownerFields(word, examples) });
        continue;
      }
      targets.add(target.id);
      await tx
        .update(words)
        .set({ pos: finalPos ?? target.pos, ...ownerFields(word, examples) })
        .where(eq(words.id, target.id));
      result.updated++;
    }
    for (const part of chunks(inserts)) {
      const rows = await tx.insert(words).values(part).returning({ id: words.id });
      for (const row of rows) targets.add(row.id);
      result.inserted += rows.length;
    }

    const kept = [...targets];
    const dropped = await tx
      .update(words)
      .set({ source: DROPPED_OWNER_SOURCE, curriculumStage: null, curriculumIndex: null })
      .where(
        and(
          eq(words.source, OWNER_LIST_SOURCE),
          kept.length ? notInArray(words.id, kept) : undefined,
        ),
      )
      .returning({ id: words.id });
    result.dropped = dropped.length;

    await tx.delete(excludedLemmas).where(eq(excludedLemmas.source, OWNER_LIST_SOURCE));
    for (const part of chunks(list.removed)) {
      await tx
        .insert(excludedLemmas)
        .values(part.map((entry) => ({ ...entry, source: OWNER_LIST_SOURCE })))
        .onConflictDoNothing();
    }
    result.removed = list.removed.length;
    return result;
  });
}
