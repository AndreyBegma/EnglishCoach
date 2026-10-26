/** Lower-cased, whitespace-collapsed, edge punctuation stripped: "We was." and "we  was" match. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
}

/** The conversation skill gives no rule tag, so a pattern is the normalised `wrong → right`. */
export function conversationPattern(original: string, corrected: string): string {
  return `${normalise(original)} → ${normalise(corrected)}`;
}
