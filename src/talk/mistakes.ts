import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { mistakes } from "../db/schema";
import type { MistakeCategory } from "./state";

// Local adapter with the signature agreed for the shared mistakes repository (slot i9). Delete
// this file and import the shared `upsertMistake` / `normaliseMistakePattern` once it is in develop.

export interface MistakeInput {
  category: MistakeCategory;
  pattern: string;
  exampleWrong: string;
  exampleRight: string;
  explanation: string;
}

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

/** Inserts the pattern or counts it up; the unique key is (user, category, pattern). */
export async function upsertMistake(db: Db, userId: number, input: MistakeInput): Promise<void> {
  await db
    .insert(mistakes)
    .values({ userId, ...input })
    .onConflictDoUpdate({
      target: [mistakes.userId, mistakes.category, mistakes.pattern],
      set: {
        count: sql`${mistakes.count} + 1`,
        lastSeenAt: sql`now()`,
        exampleWrong: input.exampleWrong,
        exampleRight: input.exampleRight,
        explanation: input.explanation,
      },
    });
}
