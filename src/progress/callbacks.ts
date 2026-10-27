import { CALLBACK_VERSION, MAX_CALLBACK_BYTES } from "../bot/callbacks";

/**
 * Progress's own inline-button codec. Wire format: `<CALLBACK_VERSION>:p:<route>`, within
 * Telegram's 64 bytes. Opening the Progress screen itself is the shared `screen: progress` button.
 * The hub's 👤 Profile button rides here too (`u`), so it needs no hub screen of its own.
 */
export type ProgressCallback = { type: "weak" } | { type: "practice" } | { type: "profile" };

const PREFIX = `${CALLBACK_VERSION}:p`;

const ROUTE = { weak: "w", practice: "g", profile: "u" } as const satisfies Record<
  ProgressCallback["type"],
  string
>;

export function encodeProgressCallback(callback: ProgressCallback): string {
  const data = `${PREFIX}:${ROUTE[callback.type]}`;
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
    case `${PREFIX}:u`:
      return { type: "profile" };
    default:
      return undefined;
  }
}
