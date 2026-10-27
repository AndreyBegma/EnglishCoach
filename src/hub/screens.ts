import { InlineKeyboard } from "grammy";
import { encodeCallback, type HubScreen } from "../bot/callbacks";
import type { Locale, Translator } from "../bot/i18n";
import { encodeProgressCallback } from "../progress/callbacks";
import type { ProgressData } from "../progress/queries";
import { renderProgress } from "../progress/render";
import type { RestoreOffer } from "../progress/streak-rules";

export interface ScreenModel {
  locale: Locale;
  dueCount: number;
  /** One-line summary of the last ended session, shown on the main screen. */
  lastSummary?: string;
  /** One line about achievements unlocked since the hub last showed any (main screen). */
  unlockNotice?: string;
  /** Set while a double goal today would restore yesterday's broken streak (main screen). */
  restoreOffer?: RestoreOffer;
  /** The Progress screen's data; the hub loads it only when that screen is rendered. */
  progress?: ProgressData;
  /** No level yet: learning waits for the placement test, the hub offers only it and Settings. */
  locked?: boolean;
}

export interface RenderedScreen {
  text: string;
  keyboard: InlineKeyboard;
  /** Unlocks this screen announces; the hub marks them shown once the message is on screen. */
  announced?: readonly string[];
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
      if (model.unlockNotice) lines.push("", model.unlockNotice);
      if (model.restoreOffer) {
        lines.push("", t("hub-streak-restore", { days: model.restoreOffer.days }));
      }
      if (model.locked) {
        return {
          text: [...lines, "", t("hub-locked")].join("\n"),
          keyboard: InlineKeyboard.from([
            [button(t("hub-placement"), { type: "placement" })],
            [button(t("hub-settings"), { type: "settings", page: "root" })],
          ]),
        };
      }
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
            InlineKeyboard.text(t("hub-profile"), encodeProgressCallback({ type: "profile" })),
          ],
          [button(t("hub-settings"), { type: "settings", page: "root" })],
        ]),
      };
    }
    case "progress":
      if (model.progress) return renderProgress(i18n, model.locale, model.progress);
      return { text: t("progress-title"), keyboard: InlineKeyboard.from([back]) };
  }
}
