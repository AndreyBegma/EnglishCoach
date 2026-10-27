import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/** Where a learner is with a syllabus topic: ⬜ not started, 🔴 learning, 🟡 shaky, ✅ mastered. */
export const topicStatusEnum = pgEnum("topic_status", [
  "not_started",
  "learning",
  "shaky",
  "mastered",
]);

export type TopicStatus = (typeof topicStatusEnum.enumValues)[number];

/** One graded item on a topic, as the rolling window keeps it. */
export type TopicItem = {
  /** The grammar-quiz item type (`gap_fill`, …). */
  type: string;
  /** 0..1, partial credit in between. */
  score: number;
  /** ISO time it was graded. */
  at: string;
};

/** A mastered topic's FSRS card, 1:1 with the ts-fsrs 5 `Card`, dates as ISO strings. */
export type TopicFsrs = {
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
};

/** One explanation method tried on the topic and how it went (filled by the adaptive-methods card). */
export type TopicMethod = Record<string, unknown>;

/**
 * The learner's progress on one syllabus topic (`src/grammar/mastery.ts` holds the rules).
 * Server-owned: only `recordTopicItem` and `recordTopicUses` write here. The syllabus is a file,
 * so `topic_id` has no FK; it is validated against it before it is written.
 */
export const topicProgress = pgTable(
  "topic_progress",
  {
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: text().notNull(),
    status: topicStatusEnum().notNull().default("not_started"),
    /** The last graded items on the topic, oldest first. */
    recentItems: jsonb().$type<TopicItem[]>().notNull().default([]),
    /** Mean score per exercise type over `recent_items`; derived, kept for readers. */
    accuracyByType: jsonb().$type<Record<string, number>>().notNull().default({}),
    /** Correct uses of the topic in free production (Talk), tagged by the correction skills. */
    transferEvidence: integer().notNull().default(0),
    /** When the accuracy rule last started to hold; the spaced confirmation counts from here. */
    criteriaMetAt: timestamp({ withTimezone: true }),
    /** When an item at least the confirmation interval after `criteria_met_at` still met it. */
    confirmedAt: timestamp({ withTimezone: true }),
    masteredAt: timestamp({ withTimezone: true }),
    /** The first time the topic was ever mastered; the mastery XP is paid once, on it. */
    firstMasteredAt: timestamp({ withTimezone: true }),
    /** Null until the topic is first mastered. */
    fsrs: jsonb().$type<TopicFsrs>(),
    /** Mirrors `fsrs.due` for the due-review query; null while there is no card. */
    reviewDue: timestamp({ withTimezone: true }),
    /** Scores of the check items answered so far in the current due review. */
    checkScores: jsonb().$type<number[]>().notNull().default([]),
    methodHistory: jsonb().$type<TopicMethod[]>().notNull().default([]),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.topicId] }),
    index("topic_progress_user_id_review_due_idx").on(table.userId, table.reviewDue),
  ],
);

export type TopicProgressRow = typeof topicProgress.$inferSelect;
