import type { CefrLevel } from "../db/schema";
import { CEFR_LEVELS } from "../settings/options";

export type GrammarTopic = {
  /** Stable key: the callback index and the i18n key suffix (`grammar-topic-<id>`). */
  id: string;
  /** English tag handed to the `grammar-quiz` skill as `topic`. */
  tag: string;
  /** Levels the topic is offered at, inclusive. */
  from: CefrLevel;
  to: CefrLevel;
};

/** Order is part of the callback wire format (the button carries the index): only append. */
export const GRAMMAR_TOPICS: readonly GrammarTopic[] = [
  { id: "tenses", tag: "verb tenses", from: "A1", to: "C2" },
  { id: "articles", tag: "articles: a/an/the/zero", from: "A1", to: "C1" },
  { id: "prepositions", tag: "prepositions", from: "A1", to: "C1" },
  { id: "comparatives", tag: "comparatives and superlatives", from: "A1", to: "B2" },
  { id: "conditionals", tag: "conditionals", from: "A2", to: "C2" },
  { id: "modals", tag: "modal verbs", from: "A2", to: "C2" },
  { id: "passive", tag: "passive voice", from: "B1", to: "C2" },
  { id: "reported_speech", tag: "reported speech", from: "B1", to: "C2" },
  { id: "gerund_infinitive", tag: "gerund vs infinitive", from: "B1", to: "C2" },
  { id: "relative_clauses", tag: "relative clauses", from: "B1", to: "C2" },
];

/** Learners who have not taken the placement test are treated as intermediate. */
export const DEFAULT_TOPIC_LEVEL: CefrLevel = "B1";

const rank = (level: CefrLevel) => CEFR_LEVELS.indexOf(level);

/** The topics worth offering at `level`, with their callback indexes. */
export function topicsForLevel(level: CefrLevel | null): { index: number; topic: GrammarTopic }[] {
  const at = rank(level ?? DEFAULT_TOPIC_LEVEL);
  return GRAMMAR_TOPICS.flatMap((topic, index) =>
    rank(topic.from) <= at && at <= rank(topic.to) ? [{ index, topic }] : [],
  );
}
