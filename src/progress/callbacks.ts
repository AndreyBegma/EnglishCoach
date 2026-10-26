import { CALLBACK_VERSION, MAX_CALLBACK_BYTES } from "../bot/callbacks";

/**
 * Progress's own inline-button codec. Wire format: `<CALLBACK_VERSION>:p:<route>`, within
 * Telegram's 64 bytes. Opening the Progress screen itself is the shared `screen: progress` button.
 */
export type ProgressCallback = { type: "weak" } | { type: "practice" };

const PREFIX = `${CALLBACK_VERSION}:p`;

export function encodeProgressCallback(callback: ProgressCallback): string {
  const data = `${PREFIX}:${callback.type === "weak" ? "w" : "g"}`;
  if (Buffer.byteLength(data) > MAX_CALLBACK_BYTES) {
    throw new Error(`callback data longer than ${MAX_CALLBACK_BYTES} bytes`);
  }
  return data;
}

/** Parses progress callback data; undefined for anything that is not a current progress button. */
export function parseProgressCallback(data: string | undefined): ProgressCallback | undefined {
  if (!data || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) return undefined;
  switch (data) {
    case `${PREFIX}:w`:
      return { type: "weak" };
    case `${PREFIX}:g`:
      return { type: "practice" };
    default:
      return undefined;
  }
}
