import { InlineKeyboard } from "grammy";
import type { Locale, Translator } from "../bot/i18n";
import type { CefrLevel, TopicStatus } from "../db/schema";
import { encodeGrammarCallback } from "./callbacks";
import type { Graded, Severity } from "./grading";
import type { NextTopic, TopicStanding } from "./next-topic";
import type { QuizItem } from "./state";
import { topicsForLevel } from "./topics";

export const QUESTIONS_PER_SESSION = 10;

const SEVERITY_MARKER: Record<Severity, string> = {
  critical: "🔴",
  moderate: "🟠",
  minor: "🟡",
};

/** How a topic's status shows next to its title. */
export const STATUS_MARKER: Record<TopicStatus, string> = {
  not_started: "⬜",
  learning: "🔴",
  shaky: "🟡",
  mastered: "✅",
};

/**
 * The topic picker: the selector's next topic first (when there is one), then Mixed, then every
 * topic of the learner's band with its status marker.
 */
export function topicPicker(
  i18n: Translator,
  locale: Locale,
  level: CefrLevel | null,
  progress: ReadonlyMap<string, TopicStanding> = new Map(),
  next?: NextTopic,
) {
  const keyboard = new InlineKeyboard();
  if (next) {
    keyboard
      .text(
        i18n.t(locale, `grammar-next-${next.reason}`, { topic: next.topic.title[locale] }),
        encodeGrammarCallback({ type: "topic", id: next.topic.id }),
      )
      .row();
  }
  keyboard.text(
    i18n.t(locale, "grammar-mixed"),
    encodeGrammarCallback({ type: "topic", id: null }),
  );
  // One topic per row: syllabus titles are too long to share a row.
  for (const topic of topicsForLevel(level)) {
    const marker = STATUS_MARKER[progress.get(topic.id)?.status ?? "not_started"];
    keyboard
      .row()
      .text(
        `${marker} ${topic.title[locale]}`,
        encodeGrammarCallback({ type: "topic", id: topic.id }),
      );
  }
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
