import type { Translator } from "../bot/i18n";
import type { SessionKindHandler } from "./session-manager";

export const DEMO_ECHOES = 3;

/**
 * Dev-only session proving cleanup end to end (ENABLE_DEMO_SESSION=true): echoes three user
 * messages, then finishes. It runs as kind `talk` until the real Talk session replaces it.
 */
export function demoSession(i18n: Translator): SessionKindHandler {
  return {
    // An echo chat: the learner's messages stay until the cleanup it demonstrates.
    keepsLearnerMessages: true,
    async onStart(session) {
      await session.send(i18n.t(session.locale, "demo-start"));
    },
    async onMessage(session, ctx) {
      const previous = ctx.session.demo;
      const echoed = (previous?.sessionId === session.session.id ? previous.echoed : 0) + 1;
      ctx.session.demo = { sessionId: session.session.id, echoed };

      const text = ctx.message?.text ?? "…";
      await session.send(i18n.t(session.locale, "demo-echo", { n: echoed, text }));
      if (echoed >= DEMO_ECHOES) {
        ctx.session.demo = undefined;
        await session.end("finished", { line: i18n.t(session.locale, "demo-summary") });
      }
    },
  };
}
