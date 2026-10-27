import { InlineKeyboard } from "grammy";
import type { Locale, Translator } from "../bot/i18n";
import { formatCefr } from "../levels/model";
import { encodeOnboardingCallback, type OnboardingCallback } from "../onboarding/callbacks";
import { PLACEMENT_QUESTIONS, PLACEMENT_SECTIONS, type PlacementSection } from "../skills/schemas";
import { SECTION_ITEMS, type SectionResult } from "./engine";
import type { TestState } from "./test";

export const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

type T = (key: string, variables?: Record<string, string | number>) => string;

const button = (label: string, data: OnboardingCallback) =>
  InlineKeyboard.text(label, encodeOnboardingCallback(data));

/** "Section 2/6 · Vocabulary · 3/7": where the learner is in the whole test. */
function header(t: T, test: TestState, section: PlacementSection): string {
  const n = test.progress.section + 1;
  const name = t(`progress-skill-${section}`);
  const perItem = PLACEMENT_QUESTIONS[section];
  if (perItem === 0) {
    return t("placement-section", { n, total: PLACEMENT_SECTIONS.length, name });
  }
  return t("placement-section-question", {
    n,
    total: PLACEMENT_SECTIONS.length,
    name,
    k: test.progress.done * perItem + test.question + 1,
    of: SECTION_ITEMS[section] * perItem,
  });
}

/**
 * The test's screen for its state: a question, a free task, or the voice question. `seq` is the
 * item counter the answer buttons carry, so a tap meant for an earlier question is stale.
 */
export function renderTest(
  t: T,
  test: TestState,
  seq: number,
): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const section = PLACEMENT_SECTIONS[test.progress.section];
  if (!section) throw new Error("test screen after the last section");
  const top = header(t, test, section);
  const skip = button(t("placement-skip-section"), { type: "skip-section" });

  if (test.needsVoice) {
    return {
      text: [top, "", t(`placement-needs-voice-${section}`)].join("\n"),
      keyboard: InlineKeyboard.from([
        [button(t("placement-voice-on"), { type: "voice-on" })],
        [skip],
      ]),
    };
  }

  const item = test.item;
  if (!item) throw new Error("test screen without an item");
  if (item.task !== null) {
    return {
      text: [top, "", t(`placement-task-${section}`), "", item.task].join("\n"),
      keyboard: InlineKeyboard.from(section === "speaking" ? [[skip]] : []),
    };
  }

  const question = item.questions[test.question];
  if (!question) throw new Error("test screen past the item's questions");
  const lines = [top, ""];
  if (section === "reading" && item.passage) lines.push(item.passage, "");
  if (section === "listening") lines.push(t("placement-listen"), "");
  lines.push(
    question.question,
    "",
    ...question.options.map((option, index) => `${OPTION_LETTERS[index]}) ${option}`),
  );
  const rows = [
    OPTION_LETTERS.map((letter, index) => button(letter, { type: "answer", seq, index })),
  ];
  if (section === "listening") rows.push([skip]);
  return { text: lines.join("\n"), keyboard: InlineKeyboard.from(rows) };
}

/**
 * The test's result in the learner's explanation language: the overall level, every skill's
 * (`~` for a skipped one), and the rubric's one-line feedback on writing and speaking.
 */
export function resultSummary(
  i18n: Translator,
  locale: Locale,
  overall: string,
  results: Record<PlacementSection, SectionResult>,
): string {
  const t: T = (key, variables) => i18n.t(locale, key, variables);
  const lines = [t("placement-result", { level: overall }), ""];
  for (const section of PLACEMENT_SECTIONS) {
    const result = results[section];
    lines.push(
      t(result.skipped ? "profile-skill-seeded" : "profile-skill", {
        skill: t(`progress-skill-${section}`),
        level: formatCefr(result.rating),
      }),
    );
  }
  const feedback = PLACEMENT_SECTIONS.flatMap((section) => results[section].feedback ?? []);
  if (feedback.length > 0) lines.push("", ...feedback);
  if (PLACEMENT_SECTIONS.some((section) => results[section].skipped)) {
    lines.push("", t("placement-result-skipped"));
  }
  return lines.join("\n");
}
