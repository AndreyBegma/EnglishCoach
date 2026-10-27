import type { CefrLevel } from "../db/schema";
import type { SyllabusTopic } from "../grammar/syllabus";
import { CEFR_LEVELS } from "../settings/options";
import type { TopicAnswer } from "./engine";

/** What the placement test says about a syllabus topic. */
export type TopicFlagStatus = "mastered" | "unknown";
export type TopicFlag = { topicId: string; status: TopicFlagStatus };

/**
 * Writes the topic flags where topic progress lives. A port: the grammar module owns that table,
 * and the bot wires its writer in; without one the flags are computed and dropped.
 */
export interface TopicFlagWriter {
  write(userId: number, flags: readonly TopicFlag[]): Promise<void>;
}

/**
 * The flags a finished test sets on the early syllabus — every topic up to the learner's grammar
 * band; the topics above it are left for the course to reach.
 * - A tested topic is `mastered` when answered right, `unknown` when answered wrong.
 * - An untested topic below the grammar band is `mastered`: the band was passed above it.
 * - An untested topic in the grammar band is `unknown`: that band is what the learner works on.
 */
export function topicFlags(
  topics: readonly SyllabusTopic[],
  grammarBand: CefrLevel,
  answers: readonly TopicAnswer[],
): TopicFlag[] {
  const tested = new Map<string, boolean>();
  for (const answer of answers) {
    // A topic asked twice counts as known only when every answer on it was right.
    tested.set(answer.topicId, (tested.get(answer.topicId) ?? true) && answer.correct);
  }
  const ceiling = CEFR_LEVELS.indexOf(grammarBand);
  const flags: TopicFlag[] = [];
  for (const topic of topics) {
    const band = CEFR_LEVELS.indexOf(topic.band);
    const correct = tested.get(topic.id);
    if (correct !== undefined) {
      flags.push({ topicId: topic.id, status: correct ? "mastered" : "unknown" });
    } else if (band < ceiling) {
      flags.push({ topicId: topic.id, status: "mastered" });
    } else if (band === ceiling) {
      flags.push({ topicId: topic.id, status: "unknown" });
    }
  }
  return flags;
}

/**
 * The topic the next grammar item tests: one of `band`'s topics not asked yet, the earliest in
 * syllabus order first, so the test samples the band's core before its edges. Undefined when the
 * band has none left (the item skill then writes an item at the band without a topic).
 */
export function nextTopic(
  topics: readonly SyllabusTopic[],
  band: CefrLevel,
  asked: readonly TopicAnswer[],
  pick: (count: number) => number = (count) => Math.floor(Math.random() * count),
): SyllabusTopic | undefined {
  const used = new Set(asked.map((answer) => answer.topicId));
  const open = topics.filter((topic) => topic.band === band && !used.has(topic.id));
  // Random within the band's first half keeps two learners at the same level from seeing the
  // same test, and stays on the band's core topics.
  const core = open.slice(0, Math.max(1, Math.ceil(open.length / 2)));
  return core.length === 0 ? undefined : core[pick(core.length)];
}
