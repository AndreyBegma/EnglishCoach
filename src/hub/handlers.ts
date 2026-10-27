import { Composer } from "grammy";
import { type HubActivity, parseCallback } from "../bot/callbacks";
import type { BotContext } from "../bot/context";
import type { SessionKind } from "../db/repositories/sessions";
import type { OnboardingFlow } from "../onboarding/flow";
import { whileTyping } from "../sessions/answer";
import { offerToCancel } from "../sessions/handlers";
import type { SessionManager } from "../sessions/session-manager";
import type { HubService } from "./hub-service";

/** Which session kind a hub button starts. Feature slots register a handler for their kind. */
const ACTIVITY_KIND: Record<HubActivity, SessionKind> = {
  learn: "vocab_new",
  review: "review",
  grammar: "grammar",
  talk: "talk",
};

export interface HubHandlerDeps {
  hub: HubService;
  sessions: SessionManager;
  /** Takes over `/start` for a learner who has not finished onboarding. */
  onboarding?: OnboardingFlow;
}

/** Answers a button nobody can handle any more and moves the user to a fresh hub. */
export async function answerOutdated(ctx: BotContext, hub: HubService): Promise<void> {
  await ctx.answerCallbackQuery({ text: ctx.t("hub-outdated") });
  await hub.bump(ctx.user);
}

export function hubHandlers({ hub, sessions, onboarding }: HubHandlerDeps): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.command(["start", "menu"], async (ctx) => {
    // Outside a session the command would linger under the hub; inside one it is tracked anyway.
    if (!ctx.learning) await ctx.deleteMessage().catch(() => {});
    if (ctx.message?.text?.startsWith("/start") && (await onboarding?.onStart(ctx))) return;
    await hub.bump(ctx.user);
  });

  composer.on("callback_query:data", async (ctx, next) => {
    const callback = parseCallback(ctx.callbackQuery.data);
    if (callback?.type !== "screen" && callback?.type !== "activity") return next();
    // Hub buttons only count on the current hub message; older copies are stale.
    const hubMessageId = await hub.messageId(ctx.user);
    if (ctx.callbackQuery.message?.message_id !== hubMessageId) return answerOutdated(ctx, hub);
    // Leaving the settings screens abandons a value the hub was asking for.
    ctx.session.settingsInput = undefined;

    switch (callback.type) {
      case "screen":
        await ctx.answerCallbackQuery();
        await hub.refresh(ctx.user, callback.screen);
        return;
      case "activity": {
        const kind = ACTIVITY_KIND[callback.activity];
        if (!sessions.handlerFor(kind)) {
          await ctx.answerCallbackQuery({ text: ctx.t("hub-coming-soon") });
          return;
        }
        // A session's first step may wait on the model: say so until it is on screen.
        await ctx.answerCallbackQuery({ text: ctx.t("answer-starting") });
        await whileTyping(ctx, async () => {
          const outcome = await sessions.start(ctx.user, kind);
          if (!outcome.started) await offerToCancel(sessions, ctx, outcome.active, ctx.user);
        });
        return;
      }
    }
  });

  return composer;
}
