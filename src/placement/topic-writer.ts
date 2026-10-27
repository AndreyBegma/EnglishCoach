import type { Db } from "../db/client";
import { lockTopicProgress, putTopicProgress } from "../db/repositories/topic-progress";
import { placeMastered, progressOf } from "../grammar/mastery";
import type { TopicFlagWriter } from "./topics";

/**
 * The topic flags into `topic_progress`: a `mastered` topic is placed as mastered, on FSRS, as
 * the mastery rules create it; an `unknown` one stays `not_started`, which is what it already is.
 * Only rows the learner has never practised are placed, so a retake never overrides real
 * progress. One transaction: the flags are stored together or not at all.
 */
export function topicProgressWriter(db: Db, now: () => Date = () => new Date()): TopicFlagWriter {
  return {
    async write(userId, flags) {
      const mastered = flags.filter((flag) => flag.status === "mastered");
      if (mastered.length === 0) return;
      const at = now();
      await db.transaction(async (tx) => {
        for (const flag of mastered) {
          const row = await lockTopicProgress(tx, userId, flag.topicId);
          if (row.status !== "not_started" || row.recentItems.length > 0) continue;
          await putTopicProgress(tx, userId, flag.topicId, placeMastered(progressOf(row), at), at);
        }
      });
    },
  };
}
