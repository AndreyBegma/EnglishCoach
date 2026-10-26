import { InlineKeyboard } from "grammy";
import type { Locale, Translator } from "../bot/i18n";
import type { CefrLevel } from "../db/schema";
import { encodeGrammarCallback } from "./callbacks";
import type { Graded, Severity } from "./grading";
import type { QuizItem } from "./state";
import { topicsForLevel } from "./topics";

export const QUESTIONS_PER_SESSION = 10;

const SEVERITY_MARKER: Record<Severity, string> = {
  critical: "🔴",
  moderate: "🟠",
  minor: "🟡",
};

export function topicPicker(i18n: Translator, locale: Locale, level: CefrLevel | null) {
  const keyboard = new InlineKeyboard().text(
    i18n.t(locale, "grammar-mixed"),
    encodeGrammarCallback({ type: "topic", index: null }),
  );
  keyboard.row();
  topicsForLevel(level).forEach(({ index, topic }, position) => {
    keyboard.text(
      i18n.t(locale, `grammar-topic-${topic.id.replaceAll("_", "-")}`),
      encodeGrammarCallback({ type: "topic", index }),
    );
    if (position % 2 === 1) keyboard.row();
  });
  return { text: i18n.t(locale, "grammar-pick-topic"), keyboard };
}

export function questionText(
  i18n: Translator,
  locale: Locale,
  n: number,
  total: number,
  item: QuizItem,
): string {
  return [
    i18n.t(locale, "grammar-question-header", { n, total }),
    item.instruction,
    "",
    item.question,
  ].join("\n");
}

export function questionKeyboard(n: number, item: QuizItem): InlineKeyboard | undefined {
  if (item.type !== "multiple_choice" || !item.options) return undefined;
  const keyboard = new InlineKeyboard();
  item.options.forEach((option, index) => {
    keyboard.text(option, encodeGrammarCallback({ type: "answer", question: n, option: index }));
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard;
}

export function feedbackText(
  i18n: Translator,
  locale: Locale,
  graded: Graded,
  cardAdded: boolean,
): string {
  const lines = [i18n.t(locale, `grammar-verdict-${graded.verdict}`)];
  if (!graded.correct) {
    lines.push(i18n.t(locale, "grammar-correct-answer", { answer: graded.correctForm }));
  }
  lines.push(graded.explanation);
  if (graded.severity) {
    lines.push(
      i18n.t(locale, "grammar-severity", {
        marker: SEVERITY_MARKER[graded.severity],
        label: i18n.t(locale, `grammar-severity-${graded.severity}`),
      }),
    );
  }
  if (cardAdded) lines.push(i18n.t(locale, "grammar-card-added"));
  return lines.join("\n");
}

/** The "try again / stop" choice after the quiz skill failed. */
export function retryKeyboard(i18n: Translator, locale: Locale): InlineKeyboard {
  return new InlineKeyboard()
    .text(i18n.t(locale, "grammar-retry"), encodeGrammarCallback({ type: "retry" }))
    .text(i18n.t(locale, "grammar-stop"), encodeGrammarCallback({ type: "stop" }));
}
