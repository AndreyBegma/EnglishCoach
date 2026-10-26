import { z } from "zod";
import { MAX_CALLBACK_BYTES } from "../bot/callbacks";
import { RATINGS, type RatingName } from "./scheduler";

/**
 * Buttons of the vocabulary sessions. Wire format: `<version>:v:<op>[:<arg>…]`, at most 64 bytes.
 * Kept apart from the hub's codec (`src/bot/callbacks.ts`); bump `VOCAB_CALLBACK_VERSION` when an
 * op changes meaning so old buttons parse as stale.
 */
export const VOCAB_CALLBACK_VERSION = 1;
const PREFIX = `${VOCAB_CALLBACK_VERSION}:v`;

export type VocabCallback =
  /** Learn words: the learner read the card and wants the check. */
  | { op: "got-it"; cardId: number }
  /** A multiple-choice answer. */
  | { op: "choice"; cardId: number; index: number }
  /** Review: the rating the learner applies after the feedback. */
  | { op: "rate"; cardId: number; rating: RatingName }
  /** Grammar pattern: reveal the corrected sentence. */
  | { op: "reveal"; cardId: number }
  /** Review: start with the first card. */
  | { op: "start" }
  /** Learn words: add a word of the learner's own. */
  | { op: "add-word" }
  /** Learn words: stop waiting for the learner's own word. */
  | { op: "add-cancel" }
  /** Ask the LLM again after it failed. */
  | { op: "retry" }
  | { op: "finish" };

const RATING_CODE: Record<RatingName, string> = { again: "a", hard: "h", good: "g", easy: "e" };

const id = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number);
const index = z
  .string()
  .regex(/^[0-3]$/)
  .transform(Number);
const rating = z
  .enum(RATINGS.map((name) => RATING_CODE[name]) as [string, ...string[]])
  .transform((code) => RATINGS.find((name) => RATING_CODE[name] === code) ?? "again");

const route = z.union([
  z.tuple([z.literal("g"), id]).transform(([, cardId]) => ({ op: "got-it" as const, cardId })),
  z
    .tuple([z.literal("c"), id, index])
    .transform(([, cardId, i]) => ({ op: "choice" as const, cardId, index: i })),
  z
    .tuple([z.literal("r"), id, rating])
    .transform(([, cardId, r]) => ({ op: "rate" as const, cardId, rating: r })),
  z.tuple([z.literal("w"), id]).transform(([, cardId]) => ({ op: "reveal" as const, cardId })),
  z.tuple([z.literal("s")]).transform(() => ({ op: "start" as const })),
  z.tuple([z.literal("a")]).transform(() => ({ op: "add-word" as const })),
  z.tuple([z.literal("x")]).transform(() => ({ op: "add-cancel" as const })),
  z.tuple([z.literal("t")]).transform(() => ({ op: "retry" as const })),
  z.tuple([z.literal("f")]).transform(() => ({ op: "finish" as const })),
]);

function partsOf(callback: VocabCallback): (string | number)[] {
  switch (callback.op) {
    case "got-it":
      return ["g", callback.cardId];
    case "choice":
      return ["c", callback.cardId, callback.index];
    case "rate":
      return ["r", callback.cardId, RATING_CODE[callback.rating]];
    case "reveal":
      return ["w", callback.cardId];
    case "start":
      return ["s"];
    case "add-word":
      return ["a"];
    case "add-cancel":
      return ["x"];
    case "retry":
      return ["t"];
    case "finish":
      return ["f"];
  }
}

export function encodeVocabCallback(callback: VocabCallback): string {
  const data = [PREFIX, ...partsOf(callback)].join(":");
  if (Buffer.byteLength(data) > MAX_CALLBACK_BYTES) {
    throw new Error(`callback data longer than ${MAX_CALLBACK_BYTES} bytes`);
  }
  return data;
}

/** True for any vocabulary button, current or stale: these never fall through to the hub. */
export function isVocabCallbackData(data: string | undefined): boolean {
  return data?.split(":")[1] === "v";
}

/** Parses callback data; undefined for anything stale, foreign or malformed. */
export function parseVocabCallback(data: string | undefined): VocabCallback | undefined {
  if (!data || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) return undefined;
  if (!data.startsWith(`${PREFIX}:`)) return undefined;
  const result = route.safeParse(data.slice(PREFIX.length + 1).split(":"));
  return result.success ? result.data : undefined;
}
