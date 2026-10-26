import { z } from "zod";
import { SUPPORTED_LOCALES } from "./i18n";

/**
 * Inline-button payloads. Wire format: `<version>:<route>[:<arg>]`, at most 64 bytes (Telegram's
 * limit). Bump `CALLBACK_VERSION` when a route changes meaning: buttons on old messages then parse
 * as stale and the bot answers "this menu is outdated" instead of doing the wrong thing.
 */
export const CALLBACK_VERSION = 1;
export const MAX_CALLBACK_BYTES = 64;

export const HUB_SCREENS = ["main", "settings", "progress"] as const;
export type HubScreen = (typeof HUB_SCREENS)[number];

/** Hub buttons that start a learning activity. */
export const HUB_ACTIVITIES = ["learn", "review", "grammar", "talk"] as const;
export type HubActivity = (typeof HUB_ACTIVITIES)[number];

export type Callback =
  | { type: "screen"; screen: HubScreen }
  | { type: "activity"; activity: HubActivity }
  | { type: "lang"; lang: (typeof SUPPORTED_LOCALES)[number] }
  | { type: "session-cancel"; sessionId: number }
  | { type: "session-keep" };

const sessionId = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number);

const route = z.union([
  z.tuple([z.literal("h"), z.enum(HUB_SCREENS)]).transform(([, screen]) => ({
    type: "screen" as const,
    screen,
  })),
  z.tuple([z.literal("a"), z.enum(HUB_ACTIVITIES)]).transform(([, activity]) => ({
    type: "activity" as const,
    activity,
  })),
  z.tuple([z.literal("l"), z.enum(SUPPORTED_LOCALES)]).transform(([, lang]) => ({
    type: "lang" as const,
    lang,
  })),
  z.tuple([z.literal("sc"), sessionId]).transform(([, id]) => ({
    type: "session-cancel" as const,
    sessionId: id,
  })),
  z.tuple([z.literal("sk")]).transform(() => ({ type: "session-keep" as const })),
]);

export function encodeCallback(callback: Callback): string {
  const parts: (string | number)[] = [CALLBACK_VERSION];
  switch (callback.type) {
    case "screen":
      parts.push("h", callback.screen);
      break;
    case "activity":
      parts.push("a", callback.activity);
      break;
    case "lang":
      parts.push("l", callback.lang);
      break;
    case "session-cancel":
      parts.push("sc", callback.sessionId);
      break;
    case "session-keep":
      parts.push("sk");
      break;
  }
  const data = parts.join(":");
  if (Buffer.byteLength(data) > MAX_CALLBACK_BYTES) {
    throw new Error(`callback data longer than ${MAX_CALLBACK_BYTES} bytes`);
  }
  return data;
}

/** Parses callback data; undefined for anything stale, foreign or malformed. */
export function parseCallback(data: string | undefined): Callback | undefined {
  if (!data || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) return undefined;
  const [version, ...rest] = data.split(":");
  if (version !== String(CALLBACK_VERSION)) return undefined;
  const result = route.safeParse(rest);
  return result.success ? result.data : undefined;
}
