import { InlineKeyboard } from "grammy";
import type { Locale, Translator } from "../bot/i18n";
import type { SizeTestItem } from "../db/schema";
import { encodeSizeTestCallback } from "./callbacks";

/** One item: the word, its meanings, "I don't know" and Stop. */
export function itemScreen(
  i18n: Translator,
  locale: Locale,
  item: SizeTestItem,
  index: number,
  total: number,
  header?: string,
): { text: string; parse_mode: "HTML"; reply_markup: InlineKeyboard } {
  const t = (key: string, variables?: Record<string, string | number>) =>
    i18n.t(locale, key, variables);
  const lines = [
    ...(header ? [escapeHtml(header), ""] : []),
    t("sizetest-item", { n: index + 1, total, word: escapeHtml(item.word) }),
  ];
  const rows = item.options.map((option, choice) => [
    InlineKeyboard.text(
      option,
      encodeSizeTestCallback({ type: "answer", item: index, option: choice }),
    ),
  ]);
  rows.push([
    InlineKeyboard.text(
      t("sizetest-unknown"),
      encodeSizeTestCallback({ type: "answer", item: index, option: null }),
    ),
  ]);
  rows.push([InlineKeyboard.text(t("sizetest-stop"), encodeSizeTestCallback({ type: "stop" }))]);
  return { text: lines.join("\n"), parse_mode: "HTML", reply_markup: InlineKeyboard.from(rows) };
}

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** "≈4200 words · ~94% of everyday text", the shared wording of a result. */
export const sizeLine = (i18n: Translator, locale: Locale, words: number, coverage: number) =>
  i18n.t(locale, "sizetest-size", { words, coverage });

/** The trend against the previous test: "+350", "−100" or nothing on the first test. */
export function trendOf(words: number, previous: number | null): string {
  if (previous === null || previous === words) return "";
  const delta = words - previous;
  return delta > 0 ? `+${delta}` : `−${-delta}`;
}
