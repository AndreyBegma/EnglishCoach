import type { CefrLevel } from "../db/schema";

export const MAX_INTEREST_TOPICS = 3;
const MAX_TOPIC_LENGTH = 60;

/** Stock topics: the English text goes to the model, `id` selects the button label. */
const STOCK = {
  routine: "your daily routine",
  family: "family and friends",
  food: "food and cooking",
  travel: "travel and places you want to visit",
  work: "work and career",
  tech: "technology in everyday life",
  society: "how society is changing",
  future: "plans and predictions for the future",
  culture: "books, films and culture",
} as const;

export type StockTopicId = keyof typeof STOCK;

const BY_LEVEL: Record<"basic" | "intermediate" | "advanced", StockTopicId[]> = {
  basic: ["routine", "family", "food"],
  intermediate: ["travel", "work", "tech"],
  advanced: ["society", "future", "culture"],
};

function band(level: CefrLevel | null): keyof typeof BY_LEVEL {
  if (level === "B1" || level === "B2") return "intermediate";
  if (level === "C1" || level === "C2") return "advanced";
  return "basic";
}

export type TopicSuggestion =
  /** Written by the learner (an interest): shown and sent as is, after trimming. */
  { kind: "interest"; text: string } | { kind: "stock"; id: StockTopicId; text: string };

/**
 * Up to three of the learner's interests, then three stock topics for their level. Deterministic
 * for the same settings, so a button carries only an index and the server resolves it again.
 */
export function suggestTopics(settings: {
  cefrLevel: CefrLevel | null;
  interests: readonly string[];
}): TopicSuggestion[] {
  const interests = new Map<string, string>();
  for (const raw of settings.interests) {
    const text = raw.trim().slice(0, MAX_TOPIC_LENGTH);
    if (text && !interests.has(text.toLowerCase())) interests.set(text.toLowerCase(), text);
  }
  return [
    ...[...interests.values()]
      .slice(0, MAX_INTEREST_TOPICS)
      .map((text): TopicSuggestion => ({ kind: "interest", text })),
    ...BY_LEVEL[band(settings.cefrLevel)].map(
      (id): TopicSuggestion => ({ kind: "stock", id, text: STOCK[id] }),
    ),
  ];
}
