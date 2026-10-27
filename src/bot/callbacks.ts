import { z } from "zod";
import type { CefrLevel } from "../db/schema/enums";
import {
  BYOK_CHOICES,
  type ByokChoice,
  CEFR_LEVELS,
  COMMON_TIMEZONES,
  ENGLISH_VARIANTS,
  PROVIDER_CHOICES,
  type ProviderChoice,
  TIME_SLOTS,
  WORDS_PER_DAY,
  type WordsPerDay,
} from "../settings/options";
import { type Locale, SUPPORTED_LOCALES } from "./i18n";

/**
 * Inline-button payloads. Wire format: `<version>:<route>[:<arg>…]`, at most 64 bytes (Telegram's
 * limit). Bump `CALLBACK_VERSION` when a route changes meaning: buttons on old messages then parse
 * as stale and the bot answers "this menu is outdated" instead of doing the wrong thing.
 */
export const CALLBACK_VERSION = 1;
export const MAX_CALLBACK_BYTES = 64;

/** Hub screens rendered by the hub itself. Settings screens are their own route (`s`). */
export const HUB_SCREENS = ["main", "progress"] as const;
export type HubScreen = (typeof HUB_SCREENS)[number];

/** Hub buttons that start a learning activity. */
export const HUB_ACTIVITIES = ["learn", "review", "grammar", "talk"] as const;
export type HubActivity = (typeof HUB_ACTIVITIES)[number];

export const SETTINGS_PAGES = [
  "root",
  "lang",
  "explain",
  "level",
  "words",
  "timezone",
  "morning",
  "evening",
  "provider",
  "model",
] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

/** Settings that take free text (or a location) instead of a button. */
export const SETTINGS_TEXT_INPUTS = ["timezone", "model", "workspace"] as const;
export type SettingsTextInput = (typeof SETTINGS_TEXT_INPUTS)[number];

/** One settings value picked from a closed list. */
export type SettingChange =
  | { field: "explainLang"; value: Locale }
  | { field: "cefrLevel"; value: CefrLevel }
  | { field: "wordsPerDay"; value: WordsPerDay }
  | { field: "timezone"; value: (typeof COMMON_TIMEZONES)[number] }
  | { field: "morningTime" | "eveningTime"; value: string }
  | { field: "remindersEnabled" | "voiceEnabled"; value: boolean }
  | { field: "englishVariant"; value: (typeof ENGLISH_VARIANTS)[number] };

export type Callback =
  | { type: "screen"; screen: HubScreen }
  | { type: "activity"; activity: HubActivity }
  | { type: "lang"; lang: Locale }
  | { type: "session-cancel"; sessionId: number }
  | { type: "session-keep" }
  /** Opens a settings page; `n` is the list page where the page has several. */
  | { type: "settings"; page: SettingsPage; n?: number }
  | { type: "set"; change: SettingChange }
  | { type: "provider"; choice: ProviderChoice }
  /** Asks for a new key for a bring-your-own-key provider. */
  | { type: "provider-key"; choice: ByokChoice }
  /** Switches back to the key already saved for that provider. */
  | { type: "provider-reuse"; choice: ByokChoice }
  /** Picks a model by its index in the listed models, or goes back to the default model. */
  | { type: "model"; index: number | "default" }
  | { type: "input"; input: SettingsTextInput }
  | { type: "input-cancel" }
  | { type: "provider-test" }
  /** Clears the Anthropic workspace ID of the active provider. */
  | { type: "provider-workspace-clear" }
  | { type: "placement" };

/** Callbacks handled by the settings module; all of them live on the hub message. */
export const SETTINGS_CALLBACKS = [
  "lang",
  "settings",
  "set",
  "provider",
  "provider-key",
  "provider-reuse",
  "model",
  "input",
  "input-cancel",
  "provider-test",
  "provider-workspace-clear",
  "placement",
] as const satisfies readonly Callback["type"][];
export type SettingsCallback = Extract<Callback, { type: (typeof SETTINGS_CALLBACKS)[number] }>;

export function isSettingsCallback(callback: Callback | undefined): callback is SettingsCallback {
  return (SETTINGS_CALLBACKS as readonly string[]).includes(callback?.type ?? "");
}

const smallInt = z
  .string()
  .regex(/^\d{1,4}$/)
  .transform(Number);

const sessionId = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number);

const flag = z.enum(["0", "1"]).transform((value) => value === "1");

/** `HHMM` on the wire (the separator is `:`), `HH:MM` everywhere else. */
const timeSlot = z
  .string()
  .regex(/^\d{4}$/)
  .transform((value) => `${value.slice(0, 2)}:${value.slice(2)}`)
  .refine((value) => TIME_SLOTS.includes(value));

const timezoneIndex = smallInt.pipe(
  z
    .number()
    .max(COMMON_TIMEZONES.length - 1)
    .transform((index) => COMMON_TIMEZONES[index] ?? COMMON_TIMEZONES[0]),
);

const wordsPerDay = smallInt.pipe(z.union(WORDS_PER_DAY.map((n) => z.literal(n))));

const set =
  <T extends SettingChange>(code: string, value: z.ZodType<T["value"], string>) =>
  (field: T["field"]) =>
    z.tuple([z.literal("sv"), z.literal(code), value]).transform(([, , parsed]) => ({
      type: "set" as const,
      change: { field, value: parsed } as T,
    }));

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
  z.tuple([z.literal("s"), z.enum(SETTINGS_PAGES)]).transform(([, page]) => ({
    type: "settings" as const,
    page,
  })),
  z.tuple([z.literal("s"), z.enum(SETTINGS_PAGES), smallInt]).transform(([, page, n]) => ({
    type: "settings" as const,
    page,
    n,
  })),
  set("ex", z.enum(SUPPORTED_LOCALES))("explainLang"),
  set("lv", z.enum(CEFR_LEVELS))("cefrLevel"),
  set("wd", wordsPerDay)("wordsPerDay"),
  set("tz", timezoneIndex)("timezone"),
  set("mt", timeSlot)("morningTime"),
  set("et", timeSlot)("eveningTime"),
  set("rm", flag)("remindersEnabled"),
  set("vc", flag)("voiceEnabled"),
  set("ev", z.enum(ENGLISH_VARIANTS))("englishVariant"),
  z.tuple([z.literal("pv"), z.enum(PROVIDER_CHOICES)]).transform(([, choice]) => ({
    type: "provider" as const,
    choice,
  })),
  z.tuple([z.literal("pk"), z.enum(BYOK_CHOICES)]).transform(([, choice]) => ({
    type: "provider-key" as const,
    choice,
  })),
  z.tuple([z.literal("pu"), z.enum(BYOK_CHOICES)]).transform(([, choice]) => ({
    type: "provider-reuse" as const,
    choice,
  })),
  z.tuple([z.literal("pm"), z.literal("d")]).transform(() => ({
    type: "model" as const,
    index: "default" as const,
  })),
  z.tuple([z.literal("pm"), smallInt]).transform(([, index]) => ({
    type: "model" as const,
    index,
  })),
  z.tuple([z.literal("pi"), z.enum(SETTINGS_TEXT_INPUTS)]).transform(([, input]) => ({
    type: "input" as const,
    input,
  })),
  z.tuple([z.literal("px")]).transform(() => ({ type: "input-cancel" as const })),
  z.tuple([z.literal("pt")]).transform(() => ({ type: "provider-test" as const })),
  z.tuple([z.literal("pw")]).transform(() => ({ type: "provider-workspace-clear" as const })),
  z.tuple([z.literal("pp")]).transform(() => ({ type: "placement" as const })),
]);

const SET_CODES: Record<SettingChange["field"], string> = {
  explainLang: "ex",
  cefrLevel: "lv",
  wordsPerDay: "wd",
  timezone: "tz",
  morningTime: "mt",
  eveningTime: "et",
  remindersEnabled: "rm",
  voiceEnabled: "vc",
  englishVariant: "ev",
};

function encodeSetValue(change: SettingChange): string | number {
  switch (change.field) {
    case "timezone":
      return COMMON_TIMEZONES.indexOf(change.value);
    case "morningTime":
    case "eveningTime":
      return change.value.replace(":", "");
    case "remindersEnabled":
    case "voiceEnabled":
      return change.value ? 1 : 0;
    default:
      return change.value;
  }
}

function partsOf(callback: Callback): (string | number)[] {
  switch (callback.type) {
    case "screen":
      return ["h", callback.screen];
    case "activity":
      return ["a", callback.activity];
    case "lang":
      return ["l", callback.lang];
    case "session-cancel":
      return ["sc", callback.sessionId];
    case "session-keep":
      return ["sk"];
    case "settings":
      return callback.n === undefined ? ["s", callback.page] : ["s", callback.page, callback.n];
    case "set":
      return ["sv", SET_CODES[callback.change.field], encodeSetValue(callback.change)];
    case "provider":
      return ["pv", callback.choice];
    case "provider-key":
      return ["pk", callback.choice];
    case "provider-reuse":
      return ["pu", callback.choice];
    case "model":
      return ["pm", callback.index === "default" ? "d" : callback.index];
    case "input":
      return ["pi", callback.input];
    case "input-cancel":
      return ["px"];
    case "provider-test":
      return ["pt"];
    case "provider-workspace-clear":
      return ["pw"];
    case "placement":
      return ["pp"];
  }
}

export function encodeCallback(callback: Callback): string {
  const data = [CALLBACK_VERSION, ...partsOf(callback)].join(":");
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
