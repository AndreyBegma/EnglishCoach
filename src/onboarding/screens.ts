import { InlineKeyboard } from "grammy";
import { type Locale, SUPPORTED_LOCALES, type Translator } from "../bot/i18n";
import type { RenderedScreen } from "../hub/screens";
import { CEFR_LEVELS, WORDS_PER_DAY } from "../settings/options";
import { PLACEMENT_MAX_ITEMS } from "../skills";
import { encodeOnboardingCallback, type OnboardingCallback } from "./callbacks";
import { EVENING_SLOTS, MORNING_SLOTS } from "./options";
import type { OnboardingState } from "./state";

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

const button = (label: string, data: OnboardingCallback) =>
  InlineKeyboard.text(label, encodeOnboardingCallback(data));

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** The single onboarding card for the learner's current step. */
export function renderOnboarding(
  i18n: Translator,
  locale: Locale,
  state: OnboardingState,
): RenderedScreen {
  const t = (key: string, variables?: Record<string, string | number>) =>
    i18n.t(locale, key, variables);

  switch (state.step) {
    case "language":
      return {
        text: t("onboarding-welcome"),
        keyboard: InlineKeyboard.from([
          SUPPORTED_LOCALES.map((lang) => button(t(`lang-${lang}`), { type: "lang", lang })),
        ]),
      };
    case "provider":
      return {
        text: t("onboarding-provider"),
        keyboard: InlineKeyboard.from([
          [button(t("onboarding-provider-server"), { type: "provider", choice: "server" })],
          [button(t("onboarding-provider-own"), { type: "provider", choice: "own" })],
        ]),
      };
    case "path":
      return {
        text: t("onboarding-path"),
        keyboard: InlineKeyboard.from([
          [button(t("onboarding-take-test"), { type: "take-test" })],
          [button(t("onboarding-know-level"), { type: "know-level" })],
        ]),
      };
    case "level":
      return {
        text: t("onboarding-choose-level"),
        keyboard: InlineKeyboard.from(
          chunk(CEFR_LEVELS, 3).map((row) =>
            row.map((level) => button(level, { type: "level", level })),
          ),
        ),
      };
    case "retake-intro":
      return {
        text: t("onboarding-retake-intro", { max: PLACEMENT_MAX_ITEMS }),
        keyboard: InlineKeyboard.from([
          [
            button(t("onboarding-start-test"), { type: "take-test" }),
            button(t("onboarding-cancel"), { type: "cancel" }),
          ],
        ]),
      };
    case "question": {
      const item = state.item;
      if (!item) throw new Error("question step without an item");
      const lines = [
        t("onboarding-question", { n: state.answers.length + 1, max: PLACEMENT_MAX_ITEMS }),
        "",
        item.question,
        "",
        ...item.options.map((option, index) => `${OPTION_LETTERS[index]}) ${option}`),
      ];
      return {
        text: lines.join("\n"),
        keyboard: InlineKeyboard.from([
          OPTION_LETTERS.map((letter, index) => button(letter, { type: "answer", index })),
        ]),
      };
    }
    case "error":
      return {
        text: t("onboarding-error"),
        keyboard: InlineKeyboard.from([
          [button(t("onboarding-retry"), { type: "retry" })],
          [
            state.mode === "retake"
              ? button(t("onboarding-cancel"), { type: "cancel" })
              : button(t("onboarding-know-level"), { type: "know-level" }),
          ],
        ]),
      };
    case "result": {
      const result = state.result;
      if (!result) throw new Error("result step without a result");
      const correct = state.answers.filter((answer) => answer.correct).length;
      const detail =
        result.summary ?? t("onboarding-result-fallback", { correct, total: state.answers.length });
      return {
        text: [t("onboarding-result", { level: result.level }), "", detail].join("\n"),
        keyboard: InlineKeyboard.from([[button(t("onboarding-continue"), { type: "continue" })]]),
      };
    }
    case "words":
      return {
        text: t("onboarding-words"),
        keyboard: InlineKeyboard.from([
          WORDS_PER_DAY.map((count) => button(String(count), { type: "words", count })),
        ]),
      };
    case "morning":
      return {
        text: t("onboarding-morning"),
        keyboard: InlineKeyboard.from(
          chunk(MORNING_SLOTS, 3).map((row) =>
            row.map((time) => button(time, { type: "morning", time })),
          ),
        ),
      };
    case "evening":
      return {
        text: t("onboarding-evening"),
        keyboard: InlineKeyboard.from(
          chunk(EVENING_SLOTS, 3).map((row) =>
            row.map((time) => button(time, { type: "evening", time })),
          ),
        ),
      };
  }
}
