import type { Locale, Translator } from "../bot/i18n";
import type { SkillOutput } from "../skills";
import { type MistakeCategory, type TalkState, topCategory } from "./state";

type ConversationTurn = SkillOutput<"conversation">;

/** Telegram HTML parse mode: model and learner text must never be able to open a tag. */
export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function correctionLines(t: Translator, locale: Locale, turn: ConversationTurn): string[] {
  const lines = turn.corrections.map(
    (c, i) =>
      `${i + 1}. <s>${escapeHtml(c.original)}</s> → <b>${escapeHtml(c.corrected)}</b> · ` +
      `${escapeHtml(t.t(locale, `talk-category-${c.category}`))}\n` +
      `<i>${escapeHtml(c.why)}</i>`,
  );
  return lines.length > 0
    ? [`✏️ <b>${t.t(locale, "talk-corrections-title")}</b>`, ...lines]
    : [`✅ ${t.t(locale, "talk-no-errors")}`];
}

/**
 * One chat message per turn: the reply, the corrections block (or the "no errors" line) and, on
 * the turns that get one, the tip. Everything the model wrote is escaped.
 */
export function renderTurn(
  t: Translator,
  locale: Locale,
  turn: ConversationTurn,
  showTip: boolean,
): string {
  const blocks = [escapeHtml(turn.reply), correctionLines(t, locale, turn).join("\n")];
  if (showTip) {
    blocks.push(
      `💡 <b>${escapeHtml(t.t(locale, `talk-tip-${turn.tip.kind}`))}</b>\n${escapeHtml(turn.tip.text)}`,
    );
  }
  return blocks.join("\n\n");
}

/** The one-line summary folded into the hub, plus the numbers behind it. */
export function summarise(t: Translator, locale: Locale, state: TalkState | undefined) {
  const messages = state?.messages ?? 0;
  const corrections = state?.corrections ?? 0;
  const top: MistakeCategory | undefined = state && topCategory(state);
  const parts =
    messages === 0
      ? []
      : [
          t.t(locale, "talk-summary-messages", { n: messages }),
          t.t(locale, "talk-summary-corrections", { n: corrections }),
          ...(top
            ? [
                t.t(locale, "talk-summary-top", {
                  top: t.t(locale, `talk-category-${top}`).toLocaleLowerCase(locale),
                }),
              ]
            : []),
        ];
  const line =
    parts.length === 0
      ? t.t(locale, "talk-summary-empty")
      : `${t.t(locale, "talk-summary-title")}: ${parts.join(", ")}`;
  return { line, messages, corrections, topCategory: top ?? null };
}
