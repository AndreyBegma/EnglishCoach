import { InlineKeyboard } from "grammy";
import type { BotContext } from "../bot/context";
import { encodeVoiceCallback } from "../voice/callbacks";
import type { T } from "./render";

/** The 🔊 pronunciation button of a word card: one row, or none when the learner has voice off. */
export function speakRow(t: T, ctx: BotContext, cardId: number) {
  if (!ctx.settings.voiceEnabled) return [];
  return [[InlineKeyboard.text(t("voice-listen"), encodeVoiceCallback({ op: "speak", cardId }))]];
}
