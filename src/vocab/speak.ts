import { type Api, InlineKeyboard } from "grammy";
import type { BotContext } from "../bot/context";
import type { CardRow } from "../db/schema";
import { encodeVoiceCallback } from "../voice/callbacks";
import type { EnglishVariant } from "../voice/engines";
import { exampleText, type T } from "./render";

/**
 * What vocabulary needs of the TTS: whether a text can be voiced for the learner (the 🔊 buttons,
 * the listening waiver), and sending it as a voice note (the listening exercise). `play` throws
 * when nothing could voice it.
 */
export interface SpeechPort {
  canPlay(text: string, variant: EnglishVariant, userId?: number): Promise<boolean>;
  play(
    api: Api,
    chatId: number,
    text: string,
    variant: EnglishVariant,
    userId?: number,
  ): Promise<{ message_id: number }>;
}

/**
 * Whether listening evidence is waived for this learner and card: voice is off, there is no TTS,
 * or nothing can voice the word for them.
 */
export async function earWaived(
  speech: SpeechPort | undefined,
  settings: { voiceEnabled: boolean; englishVariant: EnglishVariant },
  card: Pick<CardRow, "front">,
  userId: number,
): Promise<boolean> {
  if (!speech || !settings.voiceEnabled) return true;
  return !(await speech.canPlay(card.front, settings.englishVariant, userId));
}

/** The sentence the "🔊 Example" button voices: the card's first example, if any. */
export function firstExample(card: Pick<CardRow, "backJson">): string | undefined {
  const [example] = card.backJson.examples ?? [];
  const text = example === undefined ? "" : exampleText(example).trim();
  return text || undefined;
}

/**
 * The 🔊 row of a word card: the word, and its example sentence when it has one. Empty when the
 * learner has voice off, when there is no TTS, or when no engine could voice the text for them
 * now and it was never voiced before — a button that can only fail is not shown.
 */
export async function speakRow(
  t: T,
  ctx: BotContext,
  card: Pick<CardRow, "id" | "front" | "backJson" | "itemType">,
  speech: SpeechPort | undefined,
) {
  if (!speech || !ctx.settings.voiceEnabled || card.itemType === "grammar_pattern") return [];
  const variant = ctx.settings.englishVariant;
  const example = firstExample(card);
  const [word, sentence] = await Promise.all([
    speech.canPlay(card.front, variant, ctx.user.id),
    example ? speech.canPlay(example, variant, ctx.user.id) : false,
  ]);
  const row = [
    ...(word
      ? [
          InlineKeyboard.text(
            t("voice-listen"),
            encodeVoiceCallback({ op: "speak", cardId: card.id }),
          ),
        ]
      : []),
    ...(sentence
      ? [
          InlineKeyboard.text(
            t("voice-listen-example"),
            encodeVoiceCallback({ op: "speak", cardId: card.id, target: "example" }),
          ),
        ]
      : []),
  ];
  return row.length ? [row] : [];
}
