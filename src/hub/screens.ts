import { InlineKeyboard } from "grammy";
import { encodeCallback, type HubScreen } from "../bot/callbacks";
import type { Locale, Translator } from "../bot/i18n";

export interface ScreenModel {
  locale: Locale;
  dueCount: number;
  /** One-line summary of the last ended session, shown on the main screen. */
  lastSummary?: string;
}

export interface RenderedScreen {
  text: string;
  keyboard: InlineKeyboard;
}

const button = (label: string, data: Parameters<typeof encodeCallback>[0]) =>
  InlineKeyboard.text(label, encodeCallback(data));

export function renderScreen(
  i18n: Translator,
  screen: HubScreen,
  model: ScreenModel,
): RenderedScreen {
  const t = (key: string, variables?: Record<string, string | number>) =>
    i18n.t(model.locale, key, variables);
  const back = [button(t("hub-back"), { type: "screen", screen: "main" })];

  switch (screen) {
    case "main": {
      const lines = [t("hub-title")];
      if (model.lastSummary) lines.push("", t("hub-last-session", { summary: model.lastSummary }));
      return {
        text: lines.join("\n"),
        keyboard: InlineKeyboard.from([
          [
            button(t("hub-learn"), { type: "activity", activity: "learn" }),
            button(t("hub-review", { count: model.dueCount }), {
              type: "activity",
              activity: "review",
            }),
          ],
          [
            button(t("hub-grammar"), { type: "activity", activity: "grammar" }),
            button(t("hub-talk"), { type: "activity", activity: "talk" }),
          ],
          [
            button(t("hub-progress"), { type: "screen", screen: "progress" }),
            button(t("hub-settings"), { type: "settings", page: "root" }),
          ],
        ]),
      };
    }
    case "progress":
      return {
        text: [t("progress-title"), "", t("progress-placeholder")].join("\n"),
        keyboard: InlineKeyboard.from([back]),
      };
  }
}
