import type { CefrLevel } from "../db/schema/enums";
import type { PlacementAnswer, PlacementItem } from "./placement";

export type OnboardingMode = "onboarding" | "retake";

export type OnboardingStep =
  | "language"
  | "provider"
  | "path"
  | "level"
  | "retake-intro"
  | "question"
  | "error"
  | "result"
  | "words"
  | "morning"
  | "evening";

/**
 * Where the learner is in the `placement` session. Lives in grammY's session (Redis); nothing in
 * it is authoritative — the level and settings are written to the database as they are chosen.
 * `item` carries the correct answer, which is why it never goes into a button.
 */
export interface OnboardingState {
  /** The learning session this state belongs to; anything else is stale. */
  sessionId: number;
  mode: OnboardingMode;
  step: OnboardingStep;
  /** The one card message every step edits in place. */
  messageId?: number;
  answers: PlacementAnswer[];
  item?: PlacementItem;
  result?: { level: CefrLevel; summary: string | null };
  /** The line folded into the hub when the session ends. */
  summaryLine?: string;
  /** The learner wants to set up their own provider once the hub is back. */
  wantsOwnProvider: boolean;
}

declare module "../bot/context" {
  interface FlowState {
    onboarding?: OnboardingState;
  }
}
