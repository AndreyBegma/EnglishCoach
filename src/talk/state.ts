import type { Mistake } from "../db/schema";
import type { ChatMessage } from "../llm/types";

export type MistakeCategory = Mistake["category"];

/** Context window for the model: the last 12 messages (6 learner/bot exchanges). */
export const HISTORY_LIMIT = 12;

/** A tip is shown on every third learner message. */
export const TIP_EVERY = 3;

export interface TalkState {
  sessionId: number;
  /** Null = free conversation. */
  topic: string | null;
  /** The chat has begun (a topic was picked or the learner simply started typing). */
  started: boolean;
  history: ChatMessage[];
  /** Learner messages answered so far. */
  messages: number;
  corrections: number;
  categories: Partial<Record<MistakeCategory, number>>;
}

// Per-session state lives in grammY's session (Redis in production), next to the other flows.
declare module "../bot/context" {
  interface FlowState {
    talk?: TalkState;
  }
}

export function newTalkState(sessionId: number, topic: string | null, started: boolean): TalkState {
  return { sessionId, topic, started, history: [], messages: 0, corrections: 0, categories: {} };
}

/**
 * Keeps the last `HISTORY_LIMIT` messages. The provider contract wants the window to start with a
 * learner turn, so a cut that lands on a bot reply drops that one too.
 */
export function capHistory(history: ChatMessage[]): ChatMessage[] {
  const kept = history.slice(-HISTORY_LIMIT);
  return kept[0]?.role === "assistant" ? kept.slice(1) : kept;
}

/** The category with the most corrections; the first one reached wins a tie. */
export function topCategory(state: TalkState): MistakeCategory | undefined {
  let top: MistakeCategory | undefined;
  let best = 0;
  for (const [category, count] of Object.entries(state.categories) as [MistakeCategory, number][]) {
    if (count > best) {
      top = category;
      best = count;
    }
  }
  return top;
}
