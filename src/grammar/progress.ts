import type { Db } from "../db/client";
import {
  listTopicProgress,
  lockTopicProgress,
  putTopicProgress,
} from "../db/repositories/topic-progress";
import type { CefrLevel, TopicProgressRow } from "../db/schema";
import { getLevels } from "../levels/levels";
import { type TopicMastered, topicEvents } from "./events";
import {
  applyItem,
  applyTransfer,
  progressOf,
  type TopicProgress,
  type TopicStep,
} from "./mastery";
import { DEFAULT_TOPIC_LEVEL, knownTopicId } from "./topics";

/**
 * Applies one mastery step to the learner's row for `topicId` under a row lock, then emits
 * `topic.mastered` when the step mastered it. Returns the step and the event, if any.
 */
async function step(
  db: Db,
  userId: number,
  topicId: string,
  apply: (progress: TopicProgress) => TopicStep,
  at: Date,
): Promise<TopicStep & { event?: TopicMastered }> {
  const result = await db.transaction(async (tx) => {
    const row = await lockTopicProgress(tx, userId, topicId);
    const next = apply(progressOf(row));
    await putTopicProgress(tx, userId, topicId, next.progress, at);
    return next;
  });
  if (!result.mastered) return result;
  const event = { userId, topicId, at, first: result.firstMastery };
  await topicEvents.emit(event);
  return { ...result, event };
}

/**
 * A graded item on a syllabus topic, into its mastery: `type` the grammar-quiz item type, `score`
 * 0..1. An id that is not in the syllabus records nothing.
 */
export async function recordTopicItem(
  db: Db,
  userId: number,
  topicId: string | null,
  item: { type: string; score: number },
  at: Date = new Date(),
): Promise<(TopicStep & { event?: TopicMastered }) | undefined> {
  const id = knownTopicId(topicId);
  if (!id) return undefined;
  return step(db, userId, id, (progress) => applyItem(progress, item, at), at);
}

/**
 * Correct uses of syllabus topics in free production (a Talk turn), one piece of transfer evidence
 * per topic per turn. Unknown ids are dropped. Returns the events of topics this mastered.
 */
export async function recordTopicUses(
  db: Db,
  userId: number,
  topicIds: readonly string[],
  at: Date = new Date(),
): Promise<TopicMastered[]> {
  const ids = new Set(topicIds.map(knownTopicId).filter((id): id is string => id !== null));
  const events: TopicMastered[] = [];
  for (const id of ids) {
    const result = await step(db, userId, id, (progress) => applyTransfer(progress, 1, at), at);
    if (result.event) events.push(result.event);
  }
  return events;
}

/**
 * The band topics are offered at: the learner's grammar level, else their overall level, else
 * `DEFAULT_TOPIC_LEVEL` for a learner with no level yet.
 */
export async function grammarBand(db: Db, userId: number): Promise<CefrLevel> {
  const levels = await getLevels(db, userId);
  return levels?.skills.grammar?.band ?? levels?.overall.band ?? DEFAULT_TOPIC_LEVEL;
}

/** The learner's progress per topic id; a topic without a row is not started. */
export async function topicProgressMap(
  db: Db,
  userId: number,
): Promise<Map<string, TopicProgressRow>> {
  return new Map((await listTopicProgress(db, userId)).map((row) => [row.topicId, row]));
}
