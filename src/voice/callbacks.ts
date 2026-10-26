import { MAX_CALLBACK_BYTES } from "../bot/callbacks";

/**
 * The 🔊 button of a vocabulary card. Wire format: `<version>:vo:<cardId>`, at most 64 bytes.
 * Bump `VOICE_CALLBACK_VERSION` when it changes meaning so old buttons parse as stale.
 */
export const VOICE_CALLBACK_VERSION = 1;
const PREFIX = `${VOICE_CALLBACK_VERSION}:vo`;

export type VoiceCallback = { op: "speak"; cardId: number };

export function encodeVoiceCallback(callback: VoiceCallback): string {
  const data = `${PREFIX}:${callback.cardId}`;
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
  const match = new RegExp(`^${PREFIX}:(\\d{1,10})$`).exec(data);
  return match?.[1] ? { op: "speak", cardId: Number(match[1]) } : undefined;
}
