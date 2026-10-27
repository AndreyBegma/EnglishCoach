import { z } from "zod";

// The topic-tag contract every correction skill shares (conversation now; the writing and speaking
// practice skills adopt it): each correction names the syllabus topic it is about, and the turn
// names the topics it used correctly. Both are hints: the server keeps the ids that are in the
// syllabus and drops the rest, so a missing or invented id never fails the call.

/** Topics one turn may tag as used correctly; more would be guessing. */
export const MAX_TOPIC_USES = 3;

/** The syllabus topic one correction is about. */
export const correctionTopic = z
  .string()
  .nullable()
  .default(null)
  .describe("Id from task.syllabus_topics this error breaks, e.g. 'g015'; null if none fits");

/** The syllabus topics a learner's text used correctly. */
export const topicUses = z
  .array(z.string())
  .max(MAX_TOPIC_USES)
  .default([])
  .describe("Ids from task.syllabus_topics the learner's message used correctly");
