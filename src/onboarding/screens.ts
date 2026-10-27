import { InlineKeyboard } from "grammy";
import { type Locale, SUPPORTED_LOCALES, type Translator } from "../bot/i18n";
import type { RenderedScreen } from "../hub/screens";
import { renderTest } from "../placement/screens";
import {
  INTEREST_SUGGESTIONS,
  LEARNER_GOALS,
  MAX_INTERESTS,
  WORDS_PER_DAY,
} from "../settings/options";
import { interestsLine } from "../settings/screens";
import { encodeOnboardingCallback, type OnboardingCallback } from "./callbacks";
import { EVENING_SLOTS, MORNING_SLOTS } from "./options";
import type { OnboardingState } from "./state";

const button = (label: string, data: OnboardingCallback) =>
  InlineKeyboard.text(label, encodeOnboardingCallback(data));
const mark = (label: string, selected: boolean) => (selected ? `✓ ${label}` : label);

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
    case "goals": {
      const goals = state.goals ?? [];
      return {
        text: t("onboarding-goals"),
        keyboard: InlineKeyboard.from([
          ...chunk(LEARNER_GOALS, 2).map((row) =>
            row.map((goal) =>
              button(mark(t(`goal-${goal}`), goals.includes(goal)), { type: "goal", goal }),
            ),
          ),
          [button(t("onboarding-next"), { type: "goals-done" })],
        ]),
      };
    }
    case "interests": {
      const interests = state.interests ?? [];
      const chosen = new Set(interests.map((interest) => interest.toLowerCase()));
      return {
        text: [
          t("onboarding-interests", { max: MAX_INTERESTS }),
          "",
          t("profile-interests", { interests: interestsLine(t, interests) }),
        ].join("\n"),
        keyboard: InlineKeyboard.from([
          ...chunk(INTEREST_SUGGESTIONS, 3).map((row) =>
            row.map((id) =>
              button(mark(t(`interest-${id}`), chosen.has(id)), {
                type: "interest",
                index: INTEREST_SUGGESTIONS.indexOf(id),
              }),
            ),
          ),
          [
            button(t(interests.length > 0 ? "onboarding-next" : "onboarding-skip"), {
              type: "interests-done",
            }),
          ],
        ]),
      };
    }
    case "profession":
      return {
        text: t("onboarding-profession"),
        keyboard: InlineKeyboard.from([
          [button(t("onboarding-skip"), { type: "profession-skip" })],
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
    case "intro": {
      const start = button(t("onboarding-start-test"), { type: "take-test" });
      const intro = t(state.mode === "retake" ? "placement-intro-retake" : "placement-intro");
      return {
        text: intro,
        keyboard: InlineKeyboard.from([
          state.mode === "retake"
            ? [start, button(t("onboarding-cancel"), { type: "cancel" })]
            : [start],
        ]),
      };
    }
    case "test": {
      if (!state.test) throw new Error("test step without a test");
      return renderTest(t, state.test, state.itemSeq ?? 0);
    }
    case "error":
      return {
        text: t("onboarding-error"),
        keyboard: InlineKeyboard.from([
          [button(t("onboarding-retry"), { type: "retry" })],
          ...(state.mode === "retake"
            ? [[button(t("onboarding-cancel"), { type: "cancel" })]]
            : []),
        ]),
      };
    case "result": {
      if (!state.result) throw new Error("result step without a result");
      return {
        text: state.result,
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
