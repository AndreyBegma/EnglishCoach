import { and, asc, count, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  OWNER_LIST_SOURCE,
  type TtsStatusBoard,
  ttsAudio,
  ttsStatusBoard,
  userSettings,
  users,
  wordEnrichments,
  words,
} from "../schema";

export interface TtsAudioKey {
  engine: string;
  voice: string;
  textHash: string;
}

/** The Telegram `file_id` of a voice note uploaded before, if any. */
export async function findTtsFileId(db: Db, key: TtsAudioKey): Promise<string | undefined> {
  const [row] = await db
    .select({ fileId: ttsAudio.telegramFileId })
    .from(ttsAudio)
    .where(
      and(
        eq(ttsAudio.engine, key.engine),
        eq(ttsAudio.voice, key.voice),
        eq(ttsAudio.textHash, key.textHash),
      ),
    )
    .limit(1);
  return row?.fileId;
}

/** Records an uploaded voice note; a concurrent upload of the same text keeps the newer id. */
export async function saveTtsFileId(db: Db, key: TtsAudioKey, fileId: string): Promise<void> {
  await db
    .insert(ttsAudio)
    .values({ ...key, telegramFileId: fileId })
    .onConflictDoUpdate({
      target: [ttsAudio.engine, ttsAudio.voice, ttsAudio.textHash],
      set: { telegramFileId: fileId },
    });
}

/** What the voice backfill voices: the owner's words in curriculum order, then their examples. */
export interface SpeechTexts {
  words: string[];
  examples: string[];
}

/**
 * The owner's list as texts to voice: each lemma, and each word's example sentences — the owner's
 * own and the first one of every cached enrichment — in curriculum order. Not deduplicated.
 */
export async function ownerListSpeechTexts(db: Db): Promise<SpeechTexts> {
  const order = [asc(words.curriculumStage), asc(words.curriculumIndex), asc(words.id)];
  const lemmas = await db
    .select({ lemma: words.lemma, example: words.example })
    .from(words)
    .where(eq(words.source, OWNER_LIST_SOURCE))
    .orderBy(...order);
  // An example is `{ en, translation }`, or a bare string in older cards.
  const first = sql<
    string | null
  >`coalesce(${wordEnrichments.data}->'examples'->0->>'en', ${wordEnrichments.data}->'examples'->>0)`;
  const enriched = await db
    .select({ example: first })
    .from(wordEnrichments)
    .innerJoin(words, eq(words.id, wordEnrichments.wordId))
    .where(eq(words.source, OWNER_LIST_SOURCE))
    .orderBy(...order, asc(wordEnrichments.lang));
  return {
    words: lemmas.map((row) => row.lemma),
    examples: [
      ...lemmas.flatMap((row) => (row.example ? [row.example] : [])),
      ...enriched.flatMap((row) => (row.example ? [row.example] : [])),
    ],
  };
}

/** The text hashes already uploaded for each of `voices`, by any engine. */
export async function storedSpeechHashes(
  db: Db,
  voices: readonly string[],
): Promise<Map<string, Set<string>>> {
  const stored = new Map(voices.map((voice) => [voice, new Set<string>()]));
  if (voices.length === 0) return stored;
  const rows = await db
    .select({ voice: ttsAudio.voice, textHash: ttsAudio.textHash })
    .from(ttsAudio)
    .where(inArray(ttsAudio.voice, [...voices]));
  for (const row of rows) stored.get(row.voice)?.add(row.textHash);
  return stored;
}

/** Voice notes uploaded for `voices` since `since`. */
export async function countStoredSpeechSince(
  db: Db,
  voices: readonly string[],
  since: Date,
): Promise<number> {
  if (voices.length === 0) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(ttsAudio)
    .where(and(inArray(ttsAudio.voice, [...voices]), gte(ttsAudio.createdAt, since)));
  return row?.n ?? 0;
}

/** The English variants the bot's learners listen to (allowed users, admins). */
export async function learnerEnglishVariants(
  db: Db,
  adminTelegramIds: readonly number[] = [],
): Promise<("us" | "uk")[]> {
  const rows = await db
    .selectDistinct({ variant: userSettings.englishVariant })
    .from(userSettings)
    .innerJoin(users, eq(users.id, userSettings.userId))
    .where(
      or(
        eq(users.isAllowed, true),
        eq(users.isAdmin, true),
        adminTelegramIds.length ? inArray(users.telegramId, [...adminTelegramIds]) : undefined,
      ),
    )
    .orderBy(asc(userSettings.englishVariant));
  return rows.map((row) => row.variant);
}

export async function getStatusBoard(db: Db, chatId: number): Promise<TtsStatusBoard | undefined> {
  const [row] = await db
    .select()
    .from(ttsStatusBoard)
    .where(eq(ttsStatusBoard.chatId, chatId))
    .limit(1);
  return row;
}

export type StatusBoardPatch = Partial<
  Pick<TtsStatusBoard, "messageId" | "failuresOn" | "failures">
>;

export async function saveStatusBoard(
  db: Db,
  chatId: number,
  patch: StatusBoardPatch,
): Promise<void> {
  const set = { ...patch, updatedAt: new Date() };
  await db
    .insert(ttsStatusBoard)
    .values({ chatId, ...set })
    .onConflictDoUpdate({ target: ttsStatusBoard.chatId, set });
}
