import { InlineKeyboard } from "grammy";
import type { BotContext } from "../bot/context";
import type { CardRow } from "../db/schema";
import { encodeVoiceCallback } from "../voice/callbacks";
import type { EnglishVariant } from "../voice/engines";
import { exampleText, type T } from "./render";

/** What the 🔊 buttons need of the TTS: whether pressing one would produce a voice note. */
export interface SpeechPort {
  canPlay(text: string, variant: EnglishVariant, userId?: number): Promise<boolean>;
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
