import { bigint, char, date, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Voice notes already uploaded to Telegram. A `file_id` is valid for this bot in every chat, so
 * after one upload to the storage chat a text is replayed with `sendVoice(file_id)`: no synthesis,
 * no upload. Keyed by what produced the audio, so a different engine or voice is a different row.
 */
export const ttsAudio = pgTable(
  "tts_audio",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // `kokoro` | `openai`
    engine: text().notNull(),
    voice: text().notNull(),
    // sha256 hex of the normalised text (trimmed, lower case, single spaces).
    textHash: char({ length: 64 }).notNull(),
    telegramFileId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("tts_audio_engine_voice_text_hash_unique").on(table.engine, table.voice, table.textHash),
  ],
);

export type TtsAudio = typeof ttsAudio.$inferSelect;

/**
 * The voice backfill's status message in the storage chat: one row per chat, so the bot edits
 * the same message instead of posting a new one, and today's failure count survives a restart.
 */
export const ttsStatusBoard = pgTable("tts_status_board", {
  chatId: bigint({ mode: "number" }).primaryKey(),
  // Null until the message is first sent, and again after it was found deleted.
  messageId: integer(),
  // The UTC day `failures` counts.
  failuresOn: date({ mode: "string" }),
  failures: integer().notNull().default(0),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type TtsStatusBoard = typeof ttsStatusBoard.$inferSelect;
