import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { ttsAudio } from "../schema";

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
