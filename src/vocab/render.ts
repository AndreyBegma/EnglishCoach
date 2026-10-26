import type { CardExample, CardRow } from "../db/schema";

export type T = (key: string, variables?: Record<string, string | number>) => string;

/** Session messages are sent as HTML; everything from the LLM or the learner is escaped. */
export const HTML = { parse_mode: "HTML" } as const;

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Escapes, then turns the exercise prompt's `**word**` into bold. */
export function promptHtml(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/** The English sentence of an example, whichever shape the card stored it in. */
export const exampleText = (example: CardExample | string): string =>
  typeof example === "string" ? example : example.en;

/** The front and back of a word card, as Learn words shows it. */
export function cardHtml(t: T, card: Pick<CardRow, "front" | "backJson">): string {
  const back = card.backJson;
  const head = [`<b>${escapeHtml(card.front)}</b>`];
  if (back.ipa) head.push(escapeHtml(back.ipa));
  if (back.pos) head.push(`· <i>${escapeHtml(back.pos)}</i>`);

  const lines = [head.join(" ")];
  if (back.translation) lines.push(escapeHtml(back.translation));
  if (back.examples?.length) {
    lines.push("");
    for (const example of back.examples) {
      lines.push(`• ${escapeHtml(exampleText(example))}`);
      if (typeof example !== "string") lines.push(`  <i>${escapeHtml(example.translation)}</i>`);
    }
  }
  if (back.collocations?.length) {
    lines.push("", t("vocab-collocations", { list: escapeHtml(back.collocations.join(", ")) }));
  }
  if (back.mnemonic) lines.push("", t("vocab-mnemonic", { text: escapeHtml(back.mnemonic) }));
  return lines.join("\n");
}

/** One exercise: the instruction, then what the learner works on. */
export function exerciseHtml(instruction: string, prompt: string): string {
  return `${escapeHtml(instruction)}\n\n${promptHtml(prompt)}`;
}
