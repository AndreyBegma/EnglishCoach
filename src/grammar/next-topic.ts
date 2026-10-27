import type { CefrLevel, TopicStatus } from "../db/schema";
import { CEFR_LEVELS } from "../settings/options";
import type { SyllabusTopic } from "./syllabus";

/** What the selector needs to know of a topic's progress; a topic without one is not started. */
export type TopicStanding = { status: TopicStatus; reviewDue: Date | null };

export type NextTopic = {
  topic: SyllabusTopic;
  /** Why it was picked: a due review, a shaky topic, a new one, or one still being learned. */
  reason: "review" | "shaky" | "new" | "learning";
};

const statusOf = (progress: ReadonlyMap<string, TopicStanding>, id: string): TopicStatus =>
  progress.get(id)?.status ?? "not_started";

/**
 * The topic to practise next, in this order: mastered topics whose review is due (most overdue
 * first) → shaky topics → not-started topics at the learner's grammar band whose prerequisites are
 * satisfied → topics at that band still being learned. A prerequisite is satisfied when it is
 * mastered, or when it sits below the learner's band (their level vouches for it). Within a group,
 * syllabus order. Undefined when there is nothing left to offer.
 */
export function nextTopic(
  topics: readonly SyllabusTopic[],
  progress: ReadonlyMap<string, TopicStanding>,
  band: CefrLevel,
  now: Date,
): NextTopic | undefined {
  const due = topics
    .filter((topic) => {
      const standing = progress.get(topic.id);
      return (
        standing?.status === "mastered" &&
        standing.reviewDue !== null &&
        standing.reviewDue.getTime() <= now.getTime()
      );
    })
    .sort(
      (a, b) =>
        (progress.get(a.id)?.reviewDue?.getTime() ?? 0) -
        (progress.get(b.id)?.reviewDue?.getTime() ?? 0),
    );
  if (due[0]) return { topic: due[0], reason: "review" };

  const shaky = topics.find((topic) => statusOf(progress, topic.id) === "shaky");
  if (shaky) return { topic: shaky, reason: "shaky" };

  const at = CEFR_LEVELS.indexOf(band);
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const satisfied = (id: string) => {
    const prerequisite = byId.get(id);
    return (
      statusOf(progress, id) === "mastered" ||
      (prerequisite !== undefined && CEFR_LEVELS.indexOf(prerequisite.band) < at)
    );
  };
  const atBand = topics.filter((topic) => topic.band === band);
  const fresh = atBand.find(
    (topic) =>
      statusOf(progress, topic.id) === "not_started" && topic.prerequisites.every(satisfied),
  );
  if (fresh) return { topic: fresh, reason: "new" };

  const learning = atBand.find((topic) => statusOf(progress, topic.id) === "learning");
  return learning ? { topic: learning, reason: "learning" } : undefined;
}
