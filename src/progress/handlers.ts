import { Composer } from "grammy";
import type { BotContext } from "../bot/context";
import type { Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { getSettings } from "../db/repositories/users";
import { loadAchievements, renderAchievements } from "../gamification/achievements";
import { loadProfile, renderProfile } from "../gamification/profile";
import { startSeededGrammar } from "../grammar";
import { answerOutdated } from "../hub/handlers";
import type { HubService } from "../hub/hub-service";
import { offerToCancel } from "../sessions/handlers";
import type { SessionManager } from "../sessions/session-manager";
import { parseProgressCallback } from "./callbacks";
import { loadWeakSpots } from "./queries";
import { renderWeakSpots } from "./render";
import { buyFreeze } from "./streak";
import { FREEZE_PRICE_XP } from "./streak-rules";

export interface ProgressHandlerDeps {
  db: Db;
  hub: HubService;
  sessions: SessionManager;
  i18n: Translator;
}

/** The Weak spots sub-screen, "Practice these" and the Profile screen; all live on the hub message. */
export function progressHandlers({
  db,
  hub,
  sessions,
  i18n,
}: ProgressHandlerDeps): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.on("callback_query:data", async (ctx, next) => {
    const callback = parseProgressCallback(ctx.callbackQuery.data);
    if (!callback) return next();
    if (ctx.callbackQuery.message?.message_id !== (await hub.messageId(ctx.user))) {
      return answerOutdated(ctx, hub);
    }

    switch (callback.type) {
      case "weak": {
        await ctx.answerCallbackQuery();
        await hub.present(ctx.user, async () => {
          const weak = await loadWeakSpots(db, ctx.user.id);
          return renderWeakSpots(i18n, (await getSettings(db, ctx.user.id))?.uiLang ?? "en", weak);
        });
        return;
      }
      case "profile": {
        await ctx.answerCallbackQuery();
        await hub.present(ctx.user, async () => {
          const settings = await getSettings(db, ctx.user.id);
          const profile = await loadProfile(db, ctx.user.id, settings);
          return renderProfile(i18n, settings?.uiLang ?? "en", profile);
        });
        return;
      }
      case "freeze": {
        const settings = await getSettings(db, ctx.user.id);
        const outcome = await buyFreeze(db, ctx.user.id, {
          now: new Date(),
          timezone: settings?.timezone ?? "UTC",
        });
        await ctx.answerCallbackQuery({
          text: ctx.t(`profile-freeze-${outcome}`, { price: FREEZE_PRICE_XP }),
        });
        if (outcome !== "bought") return;
        await hub.present(ctx.user, async () => {
          const profile = await loadProfile(db, ctx.user.id, settings);
          return renderProfile(i18n, settings?.uiLang ?? "en", profile);
        });
        return;
      }
      case "achievements": {
        await ctx.answerCallbackQuery();
        await hub.present(ctx.user, async () => {
          const settings = await getSettings(db, ctx.user.id);
          const data = await loadAchievements(db, ctx.user.id);
          return renderAchievements(i18n, settings?.uiLang ?? "en", data, callback.page);
        });
        return;
      }
      case "practice": {
        const weak = await loadWeakSpots(db, ctx.user.id);
        if (weak.length === 0) {
          await ctx.answerCallbackQuery({ text: ctx.t("progress-practice-none") });
          return;
        }
        await ctx.answerCallbackQuery();
        const outcome = await startSeededGrammar(
          sessions,
          ctx,
          weak.map((mistake) => mistake.pattern),
        );
        if (!outcome.started) await offerToCancel(sessions, ctx, outcome.active, ctx.user);
        return;
      }
    }
  });

  return composer;
}
