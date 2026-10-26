import { InlineKeyboard } from "grammy";
import { encodeCallback } from "../bot/callbacks";
import type { Locale, Translator } from "../bot/i18n";
import type { Mistake } from "../db/schema";
import { encodeProgressCallback } from "./callbacks";
import type { ProgressData } from "./queries";

/** Telegram's message limit; screens stay below it whatever the data. */
export const MAX_MESSAGE_LENGTH = 4096;

const SPARK = "▁▂▃▄▅▆▇█";
const MAX_PATTERN_CHARS = 80;
const MAX_EXAMPLE_CHARS = 80;

export interface RenderedProgress {
  text: string;
  keyboard: InlineKeyboard;
}

/** Text sparkline: one block per value, scaled to the busiest day; a quiet day is the lowest block. */
export function sparkline(values: readonly number[]): string {
  const max = Math.max(0, ...values);
  return values
    .map((value) => {
      if (value <= 0 || max === 0) return SPARK[0];
      return SPARK[1 + Math.min(Math.floor((value / max) * (SPARK.length - 1)), SPARK.length - 2)];
    })
    .join("");
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const percent = (correct: number, answered: number) =>
  answered === 0 ? "—" : `${Math.round((correct / answered) * 100)}%`;

/** Drops trailing lines until the text fits one message. */
function fit(lines: string[]): string {
  const kept = [...lines];
  while (kept.length > 1 && kept.join("\n").length > MAX_MESSAGE_LENGTH) kept.pop();
  return kept.join("\n").slice(0, MAX_MESSAGE_LENGTH);
}

export function renderProgress(
  i18n: Translator,
  locale: Locale,
  data: ProgressData,
): RenderedProgress {
  const t = (key: string, variables?: Record<string, string | number>) =>
    i18n.t(locale, key, variables);
  const { streak, today, cards, grammar } = data;

  const lines = [
    t("progress-title"),
    "",
    data.level ? t("progress-level", { level: data.level }) : t("progress-level-unset"),
    t("progress-streak", { current: streak.current, best: streak.best }),
    t("progress-goal", { done: today.newWords, goal: data.wordsPerDay, reviews: today.reviews }) +
      (today.goalMet ? ` ${t("progress-goal-met")}` : ""),
    "",
    t("progress-cards", { new: cards.new, learning: cards.learning, review: cards.review }),
    t("progress-due", { today: cards.dueToday, tomorrow: cards.dueTomorrow }),
    t("progress-words", { count: cards.wordsLearned }),
    "",
    t("progress-activity", { spark: sparkline(data.activity) }),
    t("progress-grammar", {
      week: percent(grammar.correct7, grammar.answered7),
      month: percent(grammar.correct30, grammar.answered30),
    }),
    "",
  ];
  if (data.weak.length === 0) {
    lines.push(t("progress-weak-none"));
  } else {
    lines.push(t("progress-weak-title"));
    for (const mistake of data.weak) {
      lines.push(
        t("progress-weak-item", {
          pattern: clip(mistake.pattern, MAX_PATTERN_CHARS),
          count: mistake.count,
        }),
      );
    }
  }

  const rows = [];
  if (data.weak.length > 0) {
    rows.push([
      InlineKeyboard.text(t("progress-btn-weak"), encodeProgressCallback({ type: "weak" })),
    ]);
  }
  rows.push([
    InlineKeyboard.text(t("hub-back"), encodeCallback({ type: "screen", screen: "main" })),
  ]);
  return { text: fit(lines), keyboard: InlineKeyboard.from(rows) };
}

export function renderWeakSpots(
  i18n: Translator,
  locale: Locale,
  weak: readonly Mistake[],
): RenderedProgress {
  const t = (key: string, variables?: Record<string, string | number>) =>
    i18n.t(locale, key, variables);

  const lines = [t("progress-weak-screen-title"), ""];
  if (weak.length === 0) lines.push(t("progress-weak-none"));
  weak.forEach((mistake, index) => {
    lines.push(
      t("progress-weak-line", {
        n: index + 1,
        pattern: clip(mistake.pattern, MAX_PATTERN_CHARS),
        count: mistake.count,
        wrong: clip(mistake.exampleWrong, MAX_EXAMPLE_CHARS),
        right: clip(mistake.exampleRight, MAX_EXAMPLE_CHARS),
      }),
    );
  });

  const rows = [];
  if (weak.length > 0) {
    rows.push([
      InlineKeyboard.text(t("progress-btn-practice"), encodeProgressCallback({ type: "practice" })),
    ]);
  }
  rows.push([
    InlineKeyboard.text(t("hub-back"), encodeCallback({ type: "screen", screen: "progress" })),
  ]);
  return { text: fit(lines), keyboard: InlineKeyboard.from(rows) };
}
