import type { LearnerGoal } from "../db/schema/users";
import type { TestState } from "../placement/test";

export type OnboardingMode = "onboarding" | "retake";

export type OnboardingStep =
  | "language"
  | "goals"
  | "interests"
  | "profession"
  | "provider"
  | "intro"
  | "test"
  | "error"
  | "result"
  | "words"
  | "morning"
  | "evening";

/**
 * Where the learner is in the `placement` session. Lives in grammY's session (Redis); nothing in
 * it is authoritative — settings are written to the database as they are chosen, and the levels
 * only when the whole test is done. `test.item` carries the correct answers, which is why it
 * never goes into a button.
 */
export interface OnboardingState {
  /** The learning session this state belongs to; anything else is stale. */
  sessionId: number;
  mode: OnboardingMode;
  step: OnboardingStep;
  /** The one card message every step edits in place. */
  messageId?: number;
  /** The placement test, from its first item to its result. */
  test?: TestState;
  /**
   * Counts every question shown in this session, retries included; the answer buttons carry it,
   * so a tap meant for an earlier question never answers the one on screen.
   */
  itemSeq?: number;
  /** The test's result, in the explanation language, shown on the result step. */
  result?: string;
  /** The line folded into the hub when the session ends. */
  summaryLine?: string;
  /** The learner wants to set up their own provider once the hub is back. */
  wantsOwnProvider: boolean;
  /** Goals and interests picked so far; saved when their step is done. */
  goals?: LearnerGoal[];
  interests?: string[];
}

declare module "../bot/context" {
  interface FlowState {
    onboarding?: OnboardingState;
  }
}
