import { Composer } from "grammy";
import type { BotContext } from "../bot/context";
import type { SessionKindHandler } from "../sessions/session-manager";
import { parseOnboardingCallback } from "./callbacks";
import type { OnboardingFlow } from "./flow";

/** Onboarding buttons; anything that is not one falls through to the next handler. */
export function onboardingHandlers(flow: OnboardingFlow): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.on("callback_query:data", async (ctx, next) => {
    const callback = parseOnboardingCallback(ctx.callbackQuery.data);
    if (!callback) return next();
    await flow.onCallback(ctx, callback);
  });

  return composer;
}

/**
 * The `placement` session kind. Whoever starts the session (the first `/start`, or the Settings
 * button) knows which flavour it is and begins the flow itself, so there is nothing to do here.
 */
export const placementSession: SessionKindHandler = {
  async onStart() {},
};
