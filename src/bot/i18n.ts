import { join } from "node:path";
import { I18n } from "@grammyjs/i18n";
import type { BotContext } from "./context";

export const SUPPORTED_LOCALES = ["en", "ru", "uk"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALES_DIR = join(import.meta.dir, "..", "..", "locales");

/** Translates outside an update (hub renders, background jobs). `I18n` satisfies it. */
export interface Translator {
  t(locale: string, key: string, variables?: Record<string, string | number>): string;
}

/** Maps a Telegram `language_code` (e.g. `ru`, `uk`, `en-GB`) to a supported locale. */
export function localeFromLanguageCode(code: string | undefined): Locale {
  const base = code?.toLowerCase().split("-")[0];
  return SUPPORTED_LOCALES.find((locale) => locale === base) ?? DEFAULT_LOCALE;
}

export function createI18n() {
  return new I18n<BotContext>({
    defaultLocale: DEFAULT_LOCALE,
    directory: LOCALES_DIR,
    // Telegram does not render Unicode bidi isolation marks usefully; keep interpolated text plain.
    fluentBundleOptions: { useIsolating: false },
    // The stored UI language wins; Telegram's language_code only seeds it on first contact.
    localeNegotiator: (ctx) =>
      ctx.settings?.uiLang ?? localeFromLanguageCode(ctx.from?.language_code),
  });
}
