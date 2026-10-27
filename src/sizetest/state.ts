import type { SizeTestAnswer, SizeTestItem } from "../db/schema";

/**
 * A size test in progress, in the session's flow state. Nothing is stored until the last answer,
 * so a test that ends early leaves no trace and the next one starts over.
 */
export interface SizeTestState {
  sessionId: number;
  items: SizeTestItem[];
  /** One per answered item, in order; the item on screen is `answers.length`. */
  answers: SizeTestAnswer[];
  /** ISO time the test started. */
  startedAt: string;
}

declare module "../bot/context" {
  interface FlowState {
    sizeTest?: SizeTestState;
  }
}
