import { join } from "node:path";
import { I18n, type I18nFlavor } from "@grammyjs/i18n";
import type { Context } from "grammy";

export type BotContext = Context & I18nFlavor;

export const SUPPORTED_LOCALES = ["en", "ru", "uk"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALES_DIR = join(import.meta.dir, "..", "..", "locales");

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
    localeNegotiator: (ctx) => localeFromLanguageCode(ctx.from?.language_code),
  });
}
