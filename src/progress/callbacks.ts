import { CALLBACK_VERSION, MAX_CALLBACK_BYTES } from "../bot/callbacks";

/**
 * Progress's own inline-button codec. Wire format: `<CALLBACK_VERSION>:p:<route>[:<arg>]`, within
 * Telegram's 64 bytes. Opening the Progress screen itself is the shared `screen: progress` button.
 * The hub's 👤 Profile button rides here too (`u`), so it needs no hub screen of its own, and so
 * does the Profile's 🏆 Achievements screen (`a:<page>`).
 */
export type ProgressCallback =
  | { type: "weak" }
  | { type: "practice" }
  | { type: "profile" }
  | { type: "achievements"; page: number };

const PREFIX = `${CALLBACK_VERSION}:p`;

const ROUTE = {
  weak: "w",
  practice: "g",
  profile: "u",
  achievements: "a",
} as const satisfies Record<ProgressCallback["type"], string>;

/** Pages are small; anything longer is not a button this bot made. */
const MAX_PAGE = 999;

export function encodeProgressCallback(callback: ProgressCallback): string {
  const data =
    callback.type === "achievements"
      ? `${PREFIX}:${ROUTE.achievements}:${callback.page}`
      : `${PREFIX}:${ROUTE[callback.type]}`;
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
  }
  const page = data.startsWith(`${PREFIX}:a:`) ? data.slice(`${PREFIX}:a:`.length) : undefined;
  if (page && /^(0|[1-9]\d{0,2})$/.test(page) && Number(page) <= MAX_PAGE) {
    return { type: "achievements", page: Number(page) };
  }
  return undefined;
}
