import type { SkillOutput } from "../skills";

export type QuizItem = SkillOutput<"grammar-quiz">;

/**
 * One grammar session's progress, kept in grammY's session (Redis). Nothing here is authoritative:
 * scores that matter are written to the database as each answer is graded.
 */
export interface GrammarState {
  /** The `learning_sessions` row this state belongs to; a state of another session is stale. */
  sessionId: number;
  /** The syllabus tag the learner chose; null for Mixed. */
  topic: string | null;
  /** Weak-spot patterns this session practises, in turn, instead of a syllabus topic. */
  seed?: string[];
  /** Questions sent so far. */
  asked: number;
  answered: number;
  correct: number;
  /** Topic tags asked so far, so the quiz skill does not repeat itself. */
  recentTopics: string[];
  /** Wrong answers per topic tag, for the "weak" part of the summary. */
  wrongByTopic: Record<string, number>;
  /** The question waiting for an answer. */
  current?: { n: number; item: QuizItem; messageId: number };
}

declare module "../bot/context" {
  interface FlowState {
    grammar?: GrammarState;
    /** Set by Progress's "Practice these" just before it starts the grammar session. */
    grammarSeed?: string[];
  }
}
