import type { BotContext } from "../bot/context";
import type { SessionManager, StartOutcome } from "../sessions/session-manager";

/**
 * Starts a grammar session that practises the given mistake patterns (the `mistakes.pattern`
 * values) in turn, one question each and cycling, instead of showing the topic picker. Without
 * patterns it is an ordinary grammar start.
 *
 * It needs the update's `ctx`: the quiz state lives in the learner's grammY session. A caller
 * running outside an update (a scheduled routine) has to start the session from one.
 * When the user already has an active session nothing changes and the outcome says so.
 */
export async function startSeededGrammar(
  sessions: SessionManager,
  ctx: BotContext,
  patterns: readonly string[],
): Promise<StartOutcome> {
  ctx.session.grammarSeed = patterns.length > 0 ? [...patterns] : undefined;
  try {
    return await sessions.start(ctx.user, "grammar", ctx);
  } finally {
    // `onStart` consumes it; this covers a refused start so the seed cannot leak into a later one.
    ctx.session.grammarSeed = undefined;
  }
}
