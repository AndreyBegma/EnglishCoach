import { z } from "zod";
import { CALLBACK_VERSION, MAX_CALLBACK_BYTES } from "../bot/callbacks";
import { SUPPORTED_LOCALES } from "../bot/i18n";
import {
  CEFR_LEVELS,
  INTEREST_SUGGESTIONS,
  LEARNER_GOALS,
  type LearnerGoal,
  WORDS_PER_DAY,
} from "../settings/options";
import { EVENING_SLOTS, MORNING_SLOTS } from "./options";

/**
 * Onboarding buttons. Wire format `1:o:<route>[:<arg>]`: the shared version prefix, then this
 * module's own namespace, so the central codec never sees them (it parses them as stale and
 * falls through to the next middleware).
 */
export type OnboardingCallback =
  | { type: "lang"; lang: (typeof SUPPORTED_LOCALES)[number] }
  | { type: "goal"; goal: LearnerGoal }
  | { type: "goals-done" }
  /** A suggested interest, by its index in `INTEREST_SUGGESTIONS`. */
  | { type: "interest"; index: number }
  | { type: "interests-done" }
  | { type: "profession-skip" }
  | { type: "provider"; choice: "server" | "own" }
  | { type: "take-test" }
  | { type: "know-level" }
  | { type: "level"; level: (typeof CEFR_LEVELS)[number] }
  /** `seq` is the item the button belongs to (`OnboardingState.itemSeq`); another item's is stale. */
  | { type: "answer"; seq: number; index: number }
  | { type: "continue" }
  | { type: "words"; count: (typeof WORDS_PER_DAY)[number] }
  | { type: "morning"; time: string }
  | { type: "evening"; time: string }
  | { type: "retry" }
  | { type: "cancel" };

const NAMESPACE = "o";

const slot = (slots: readonly string[]) =>
  z
    .string()
    .regex(/^\d{4}$/)
    .transform((value) => `${value.slice(0, 2)}:${value.slice(2)}`)
    .refine((value) => slots.includes(value));

const route = z.union([
  z.tuple([z.literal("l"), z.enum(SUPPORTED_LOCALES)]).transform(([, lang]) => ({
    type: "lang" as const,
    lang,
  })),
  z.tuple([z.literal("g"), z.enum(LEARNER_GOALS)]).transform(([, goal]) => ({
    type: "goal" as const,
    goal,
  })),
  z.tuple([z.literal("gd")]).transform(() => ({ type: "goals-done" as const })),
  z
    .tuple([
      z.literal("i"),
      z
        .string()
        .regex(/^\d{1,2}$/)
        .transform(Number)
        .pipe(z.number().max(INTEREST_SUGGESTIONS.length - 1)),
    ])
    .transform(([, index]) => ({ type: "interest" as const, index })),
  z.tuple([z.literal("id")]).transform(() => ({ type: "interests-done" as const })),
  z.tuple([z.literal("ps")]).transform(() => ({ type: "profession-skip" as const })),
  z.tuple([z.literal("pv"), z.enum(["s", "own"])]).transform(([, choice]) => ({
    type: "provider" as const,
    choice: choice === "s" ? ("server" as const) : ("own" as const),
  })),
  z.tuple([z.literal("t")]).transform(() => ({ type: "take-test" as const })),
  z.tuple([z.literal("k")]).transform(() => ({ type: "know-level" as const })),
  z.tuple([z.literal("lv"), z.enum(CEFR_LEVELS)]).transform(([, level]) => ({
    type: "level" as const,
    level,
  })),
  z
    .tuple([z.literal("a"), z.string().regex(/^\d{1,4}$/), z.enum(["0", "1", "2", "3"])])
    .transform(([, seq, index]) => ({
      type: "answer" as const,
      seq: Number(seq),
      index: Number(index),
    })),
  z.tuple([z.literal("c")]).transform(() => ({ type: "continue" as const })),
  z
    .tuple([
      z.literal("wd"),
      z
        .string()
        .regex(/^\d{1,2}$/)
        .transform(Number)
        .pipe(z.union(WORDS_PER_DAY.map((n) => z.literal(n)))),
    ])
    .transform(([, count]) => ({ type: "words" as const, count })),
  z.tuple([z.literal("mt"), slot(MORNING_SLOTS)]).transform(([, time]) => ({
    type: "morning" as const,
    time,
  })),
  z.tuple([z.literal("et"), slot(EVENING_SLOTS)]).transform(([, time]) => ({
    type: "evening" as const,
    time,
  })),
  z.tuple([z.literal("r")]).transform(() => ({ type: "retry" as const })),
  z.tuple([z.literal("x")]).transform(() => ({ type: "cancel" as const })),
]);

function partsOf(callback: OnboardingCallback): (string | number)[] {
  switch (callback.type) {
    case "lang":
      return ["l", callback.lang];
    case "goal":
      return ["g", callback.goal];
    case "goals-done":
      return ["gd"];
    case "interest":
      return ["i", callback.index];
    case "interests-done":
      return ["id"];
    case "profession-skip":
      return ["ps"];
    case "provider":
      return ["pv", callback.choice === "server" ? "s" : "own"];
    case "take-test":
      return ["t"];
    case "know-level":
      return ["k"];
    case "level":
      return ["lv", callback.level];
    case "answer":
      return ["a", callback.seq, callback.index];
    case "continue":
      return ["c"];
    case "words":
      return ["wd", callback.count];
    case "morning":
      return ["mt", callback.time.replace(":", "")];
    case "evening":
      return ["et", callback.time.replace(":", "")];
    case "retry":
      return ["r"];
    case "cancel":
      return ["x"];
  }
}

export function encodeOnboardingCallback(callback: OnboardingCallback): string {
  const data = [CALLBACK_VERSION, NAMESPACE, ...partsOf(callback)].join(":");
  if (Buffer.byteLength(data) > MAX_CALLBACK_BYTES) {
    throw new Error(`callback data longer than ${MAX_CALLBACK_BYTES} bytes`);
  }
  return data;
}

/** Undefined for anything that is not an onboarding button, or is stale or malformed. */
export function parseOnboardingCallback(data: string | undefined): OnboardingCallback | undefined {
  if (!data || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) return undefined;
  const [version, namespace, ...rest] = data.split(":");
  if (version !== String(CALLBACK_VERSION) || namespace !== NAMESPACE) return undefined;
  const result = route.safeParse(rest);
  return result.success ? result.data : undefined;
}
