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

/** The word, its IPA and part of speech; an abstract word's emoji first. */
function headHtml(card: Pick<CardRow, "front" | "backJson">): string {
  const back = card.backJson;
  const head = [`<b>${escapeHtml(card.front)}</b>`];
  if (back.emoji) head.unshift(escapeHtml(back.emoji));
  if (back.ipa) head.push(escapeHtml(back.ipa));
  if (back.pos) head.push(`· <i>${escapeHtml(back.pos)}</i>`);
  return head.join(" ");
}

/** The front and back of a word card, as Learn words shows it. */
export function cardHtml(t: T, card: Pick<CardRow, "front" | "backJson">): string {
  const back = card.backJson;
  const lines = [headHtml(card)];
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

/** Telegram's limit on a photo caption, counted after the HTML is parsed. */
export const MAX_CAPTION = 1024;
/** Below this many characters the example is dropped rather than cut. */
const MIN_EXAMPLE = 20;

const escapeAttr = (text: string) => escapeHtml(text).replaceAll('"', "&quot;");

/** What the learner sees of an HTML caption: Telegram counts this against `MAX_CAPTION`. */
export function visibleLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&").length;
}

export interface PhotoCredit {
  source: "pexels" | "unsplash";
  authorName: string | null;
  authorUrl: string | null;
  pageUrl: string | null;
}

const SOURCE_NAME = { pexels: "Pexels", unsplash: "Unsplash" } as const;

const link = (text: string, href: string | null) =>
  href ? `<a href="${escapeAttr(href)}">${escapeHtml(text)}</a>` : escapeHtml(text);

/**
 * The caption of a word card shown as a photo: the word, IPA, translation, the first example and
 * the photo's credit, below the previous step's result. The example is cut first to fit
 * `MAX_CAPTION`; undefined when even without it the caption is too long.
 */
export function cardCaption(
  t: T,
  card: Pick<CardRow, "front" | "backJson">,
  credit: PhotoCredit,
  lead?: string,
): string | undefined {
  const back = card.backJson;
  const top = [lead ? `${lead}\n\n${headHtml(card)}` : headHtml(card)];
  if (back.translation) top.push(escapeHtml(back.translation));
  const author = link(credit.authorName ?? SOURCE_NAME[credit.source], credit.authorUrl);
  const credits = t("vocab-photo-credit", {
    author,
    source: link(SOURCE_NAME[credit.source], credit.pageUrl),
  });
  const without = `${top.join("\n")}\n\n${credits}`;
  if (visibleLength(without) > MAX_CAPTION) return undefined;

  const first = back.examples?.[0];
  if (!first) return without;
  const example = exampleText(first);
  const room = MAX_CAPTION - visibleLength(without) - "\n\n• ".length;
  if (room < MIN_EXAMPLE) return without;
  const shown = example.length > room ? `${example.slice(0, room - 1)}…` : example;
  return `${top.join("\n")}\n\n• ${escapeHtml(shown)}\n\n${credits}`;
}

/** One exercise: the instruction, then what the learner works on. */
export function exerciseHtml(instruction: string, prompt: string): string {
  return `${escapeHtml(instruction)}\n\n${promptHtml(prompt)}`;
}
