import { z } from "zod";
import type { BotContext } from "../bot/context";
import { EVIDENCE_ORDER } from "./mastery";
import { RATINGS } from "./scheduler";

const cardId = z.number().int().positive();

/** What a vocabulary session is waiting for. One step at a time: one question per message. */
const step = z.discriminatedUnion("kind", [
  /** Learn words: a card is shown, waiting for "Got it". */
  z.object({ kind: z.literal("card"), cardId }),
  /** A multiple-choice question is open. */
  z.object({
    kind: z.literal("choice"),
    cardId,
    mode: z.enum(["recognition", "listening", "particle"]).default("recognition"),
    options: z.array(z.string()).length(4),
    correctIndex: z.number().int().min(0).max(3),
    askedAt: z.number(),
  }),
  /** A typed answer is expected. */
  z.object({
    kind: z.literal("typed"),
    cardId,
    mode: z.enum(["production", "cloze", "partner", "transform", "own_sentence"]),
    prompt: z.string(),
    accepted: z.array(z.string()),
    askedAt: z.number(),
  }),
  /**
   * Review: feedback is shown, waiting for the learner to apply a rating (self-graded: none).
   * `evidence` is what the answer proved; it is kept only if the rating passes.
   */
  z.object({
    kind: z.literal("rate"),
    cardId,
    suggested: z.enum(RATINGS).optional(),
    evidence: z.array(z.enum(EVIDENCE_ORDER)).optional(),
  }),
  /** Review: a grammar pattern is shown, waiting for "Show answer". */
  z.object({ kind: z.literal("reveal"), cardId }),
  /** Learn words: waiting for the learner to type their own word. */
  z.object({ kind: z.literal("add-word") }),
  /** The LLM failed; "Retry" runs `retry` again. */
  z.object({
    kind: z.literal("failed"),
    retry: z.enum(["next", "exercise"]),
    cardId: cardId.optional(),
  }),
  /** Nothing open: a header or "done for today" with its buttons. */
  z.object({ kind: z.literal("idle") }),
]);

export const vocabFlow = z.object({ sessionId: z.number().int().positive(), step });

export type VocabFlow = z.infer<typeof vocabFlow>;
export type VocabStep = z.infer<typeof step>;

declare module "../bot/context" {
  interface FlowState {
    vocab?: VocabFlow;
  }
}

/** The flow state of session `sessionId`; undefined when it belongs to another session or is corrupt. */
export function readFlow(ctx: BotContext, sessionId: number): VocabStep | undefined {
  const parsed = vocabFlow.safeParse(ctx.session.vocab);
  return parsed.success && parsed.data.sessionId === sessionId ? parsed.data.step : undefined;
}

export function writeFlow(ctx: BotContext, sessionId: number, next: VocabStep): void {
  ctx.session.vocab = { sessionId, step: next };
}

export function clearFlow(ctx: BotContext): void {
  ctx.session.vocab = undefined;
}
