import { MAX_CALLBACK_BYTES } from "../bot/callbacks";

/**
 * The 🔊 buttons of a vocabulary card. Wire format: `<version>:vo:<cardId>` for the word,
 * `<version>:vo:<cardId>:e` for its example sentence; at most 64 bytes.
 * Bump `VOICE_CALLBACK_VERSION` when it changes meaning so old buttons parse as stale.
 */
export const VOICE_CALLBACK_VERSION = 1;
const PREFIX = `${VOICE_CALLBACK_VERSION}:vo`;

/** What a 🔊 button voices: the card's word, or its first example sentence. */
export type SpeechTarget = "word" | "example";

export type VoiceCallback = { op: "speak"; cardId: number; target?: SpeechTarget };

export function encodeVoiceCallback(callback: VoiceCallback): string {
  const suffix = callback.target === "example" ? ":e" : "";
  const data = `${PREFIX}:${callback.cardId}${suffix}`;
  if (Buffer.byteLength(data) > MAX_CALLBACK_BYTES) {
    throw new Error(`callback data longer than ${MAX_CALLBACK_BYTES} bytes`);
  }
  return data;
}

/** True for any voice button, current or stale: these never fall through to the hub. */
export function isVoiceCallbackData(data: string | undefined): boolean {
  return data?.split(":")[1] === "vo";
}

/** Parses callback data; undefined for anything stale, foreign or malformed. */
export function parseVoiceCallback(data: string | undefined): VoiceCallback | undefined {
  if (!data || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) return undefined;
  const match = new RegExp(`^${PREFIX}:(\\d{1,10})(:e)?$`).exec(data);
  if (!match?.[1]) return undefined;
  return { op: "speak", cardId: Number(match[1]), target: match[2] ? "example" : "word" };
}
