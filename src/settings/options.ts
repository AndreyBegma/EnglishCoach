import { cefrLevelEnum } from "../db/schema/enums";
import type { EnglishVariant } from "../voice/engines";

/** The closed answer spaces of the settings screens. Callback data carries these values. */

export const CEFR_LEVELS = cefrLevelEnum.enumValues;

/** Pronunciation the bot voices words in; the settings button switches between the two. */
export const ENGLISH_VARIANTS = ["us", "uk"] as const satisfies readonly EnglishVariant[];

export const WORDS_PER_DAY = [3, 5, 10, 15, 20] as const;
export type WordsPerDay = (typeof WORDS_PER_DAY)[number];

/** Offered as buttons; anything else is typed as an IANA name or found from a shared location. */
export const COMMON_TIMEZONES = [
  "Europe/Kyiv",
  "Europe/Warsaw",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Asia/Tbilisi",
  "Asia/Dubai",
  "Asia/Almaty",
  "Asia/Bangkok",
  "Asia/Tokyo",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
] as const;

/** Every half hour of the day, `HH:MM`. */
export const TIME_SLOTS: readonly string[] = Array.from({ length: 48 }, (_, i) => {
  const hours = String(Math.floor(i / 2)).padStart(2, "0");
  return `${hours}:${i % 2 === 0 ? "00" : "30"}`;
});

/** The time picker shows half a day per page. */
export const TIME_PAGE_SIZE = 24;

/** Bring-your-own-key choices. The three OpenAI-compatible ones differ only in the base URL. */
export const BYOK_CHOICES = ["anthropic", "openai", "openrouter", "custom"] as const;
export type ByokChoice = (typeof BYOK_CHOICES)[number];

/** Base URL per OpenAI-compatible preset; `null` is api.openai.com. `custom` is typed by the user. */
export const OPENAI_PRESET_URLS = {
  openai: null,
  openrouter: "https://openrouter.ai/api/v1",
} as const;

/** Choices on the provider screen that need no key. `runner` is shown but not selectable in v1. */
export const KEYLESS_CHOICES = ["server", "claude-code", "runner"] as const;
export type KeylessChoice = (typeof KEYLESS_CHOICES)[number];

export type ProviderChoice = ByokChoice | KeylessChoice;
export const PROVIDER_CHOICES = [...KEYLESS_CHOICES, ...BYOK_CHOICES] as const;

/** Models per page in the model picker. */
export const MODEL_PAGE_SIZE = 8;
