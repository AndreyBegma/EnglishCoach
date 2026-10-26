import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createI18n,
  DEFAULT_LOCALE,
  LOCALES_DIR,
  type Locale,
  localeFromLanguageCode,
  SUPPORTED_LOCALES,
} from "../src/bot/i18n";

/** Top-level Fluent message and term IDs defined in a `.ftl` file. */
function keysOf(locale: string): string[] {
  const source = readFileSync(join(LOCALES_DIR, `${locale}.ftl`), "utf8");
  return [...source.matchAll(/^(-?[a-zA-Z][\w-]*)\s*=/gm)].map((match) => match[1] ?? "").sort();
}

describe("locales", () => {
  test("there is exactly one .ftl file per supported locale", () => {
    const files = readdirSync(LOCALES_DIR)
      .filter((file) => file.endsWith(".ftl"))
      .sort();
    expect(files).toEqual(SUPPORTED_LOCALES.map((locale) => `${locale}.ftl`).sort());
  });

  test("every key exists in every locale", () => {
    const all = new Set(SUPPORTED_LOCALES.flatMap(keysOf));
    expect(all.size).toBeGreaterThan(0);
    for (const locale of SUPPORTED_LOCALES) {
      expect({ locale, keys: keysOf(locale) }).toEqual({ locale, keys: [...all].sort() });
    }
  });

  test("every key translates in every locale", () => {
    const i18n = createI18n();
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of keysOf(locale)) {
        if (key.startsWith("-")) continue; // terms are referenced, not translated directly
        const text = i18n.t(locale, key);
        expect(text).not.toBe(key);
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("localeFromLanguageCode", () => {
  test.each<[string | undefined, Locale]>([
    ["ru", "ru"],
    ["uk", "uk"],
    ["en", "en"],
    ["en-GB", "en"],
    ["RU", "ru"],
    ["de", DEFAULT_LOCALE],
    [undefined, DEFAULT_LOCALE],
  ])("%p → %p", (code, expected) => {
    expect(localeFromLanguageCode(code)).toBe(expected);
  });
});
