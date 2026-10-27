import type { FSRS } from "ts-fsrs";
import type { Db } from "../db/client";
import type { Tx } from "../db/repositories/levels";
import {
  listTopicProgress,
  lockTopicProgress,
  putTopicProgress,
} from "../db/repositories/topic-progress";
import {
  countTransferEvents,
  insertTransferEvent,
  type TransferCount,
} from "../db/repositories/transfer-events";
import type { CefrLevel, TopicProgressRow, TransferKind, TransferSource } from "../db/schema";
import { fsrsFor } from "../fsrs";
import { getLevels } from "../levels/levels";
import { type TopicMastered, topicEvents } from "./events";
import {
  applyItem,
  applyTransfer,
  ERROR_FREE_MS,
  progressOf,
  TOPIC_SCHEDULER,
  type TopicProgress,
  type TopicStep,
} from "./mastery";
import { DEFAULT_TOPIC_LEVEL, knownTopicId } from "./topics";

/**
 * Applies one mastery step to the learner's row for `topicId` under a row lock (with `also`, more
 * writes in the same transaction), then emits `topic.mastered` when the step mastered it. Returns
 * the step and the event, if any.
 */
async function step(
  db: Db,
  userId: number,
  topicId: string,
  apply: (progress: TopicProgress, scheduler: FSRS) => TopicStep,
  at: Date,
  also?: (tx: Tx) => Promise<void>,
): Promise<TopicStep & { event?: TopicMastered }> {
  const result = await db.transaction(async (tx) => {
    const row = await lockTopicProgress(tx, userId, topicId);
    const next = apply(progressOf(row), await fsrsFor(tx, userId, TOPIC_SCHEDULER));
    await putTopicProgress(tx, userId, topicId, next.progress, at);
    await also?.(tx);
    return next;
  });
  if (!result.mastered) return result;
  const event = { userId, topicId, at, first: result.firstMastery };
  await topicEvents.emit(event);
  return { ...result, event };
}

/**
 * A graded item on a syllabus topic, into its mastery: `type` the grammar-quiz item type, `score`
 * 0..1, `session` the learning session it was answered in. An id that is not in the syllabus
 * records nothing.
 */
export async function recordTopicItem(
  db: Db,
  userId: number,
  topicId: string | null,
  item: { type: string; score: number; session: number },
  at: Date = new Date(),
): Promise<(TopicStep & { event?: TopicMastered }) | undefined> {
  const id = knownTopicId(topicId);
  if (!id) return undefined;
  return step(
    db,
    userId,
    id,
    (progress, scheduler) => applyItem(progress, item, at, scheduler),
    at,
  );
}

/** Where a corrected message in free production came from. */
export type TransferOrigin = {
  source: TransferSource;
  sessionId: number | null;
  messageId: number | null;
};

const knownIds = (ids: readonly string[]) =>
  new Set(ids.map(knownTopicId).filter((id): id is string => id !== null));

/**
 * The syllabus topics one corrected message in free production was tagged with: `errors` from its
 * corrections, `correct` from its notable correct uses. One `transfer_events` row and one mastery
 * step per topic and kind; a topic tagged both ways counts as an error only. Unknown ids are
 * dropped. Returns the events of topics this mastered.
 */
export async function recordTransfer(
  db: Db,
  userId: number,
  origin: TransferOrigin,
  tags: { correct: readonly string[]; errors: readonly string[] },
  at: Date = new Date(),
): Promise<TopicMastered[]> {
  const errors = knownIds(tags.errors);
  const correct = [...knownIds(tags.correct)].filter((id) => !errors.has(id));
  const tagged = [
    ...[...errors].map((topicId) => ({ topicId, kind: "error" as const })),
    ...correct.map((topicId) => ({ topicId, kind: "correct" as const })),
  ];
  const events: TopicMastered[] = [];
  for (const { topicId, kind } of tagged) {
    const result = await step(
      db,
      userId,
      topicId,
      (progress, scheduler) => applyTransfer(progress, kind, at, scheduler),
      at,
      (tx) => insertTransferEvent(tx, { userId, topicId, kind, ...origin, createdAt: at }),
    );
    if (result.event) events.push(result.event);
  }
  return events;
}

/** What the topic screen shows of a topic's transfer evidence, per source. */
export type TransferSummary = {
  /** Correct uses, ever. */
  correct: Partial<Record<TransferSource, number>>;
  /** Errors within the mastery rule's error-free window. */
  recentErrors: Partial<Record<TransferSource, number>>;
};

export async function transferSummary(
  db: Db,
  userId: number,
  topicId: string,
  at: Date = new Date(),
): Promise<TransferSummary> {
  const [all, recent] = await Promise.all([
    countTransferEvents(db, userId, topicId),
    countTransferEvents(db, userId, topicId, new Date(at.getTime() - ERROR_FREE_MS)),
  ]);
  const of = (rows: TransferCount[], kind: TransferKind) =>
    Object.fromEntries(rows.filter((r) => r.kind === kind).map((r) => [r.source, r.count]));
  return { correct: of(all, "correct"), recentErrors: of(recent, "error") };
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
