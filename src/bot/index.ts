import { Bot, type BotConfig, type StorageAdapter, session } from "grammy";
import type { Db } from "../db/client";
import { answerOutdated, hubHandlers } from "../hub/handlers";
import { HubService } from "../hub/hub-service";
import type { Logger } from "../log";
import { demoSession } from "../sessions/demo";
import { offerToCancel, sessionMiddleware } from "../sessions/handlers";
import { SessionManager, type SessionTimeouts } from "../sessions/session-manager";
import { accessMiddleware, adminCommands, type RefusalGate } from "./access";
import type { BotContext, FlowState } from "./context";
import { createI18n } from "./i18n";

export interface BotDeps {
  token: string;
  db: Db;
  log: Logger;
  adminIds: readonly number[];
  /** grammY session storage for multi-step flows (Redis in production). */
  storage: StorageAdapter<FlowState>;
  refusals: RefusalGate;
  timeouts: SessionTimeouts;
  enableDemoSession: boolean;
  /** Tests pass `botInfo` here so the bot never calls getMe. */
  botConfig?: BotConfig<BotContext>;
}

/**
 * Composes the bot. Middleware order matters: access (sets ctx.user/settings) → i18n (reads
 * ctx.settings) → grammY session → learning session → admin → hub → fallbacks.
 */
export function createBot(deps: BotDeps) {
  const { db, log } = deps;
  const bot = new Bot<BotContext>(deps.token, deps.botConfig);
  const i18n = createI18n();
  const hub = new HubService({ api: bot.api, db, i18n, log });
  const sessions = new SessionManager({
    api: bot.api,
    db,
    hub,
    timeouts: deps.timeouts,
    log,
    i18n,
  });

  if (deps.enableDemoSession) sessions.register("talk", demoSession(i18n));

  bot.use(accessMiddleware({ db, adminIds: deps.adminIds, refusals: deps.refusals, i18n, log }));
  bot.use(i18n);
  bot.use(session({ initial: (): FlowState => ({}), storage: deps.storage }));
  bot.use(sessionMiddleware(sessions));
  bot.use(adminCommands(db));
  bot.use(hubHandlers({ db, hub, sessions }));

  if (deps.enableDemoSession) {
    bot.command("demo", async (ctx) => {
      if (!ctx.learning) await ctx.deleteMessage().catch(() => {});
      const outcome = await sessions.start(ctx.user, "talk");
      if (!outcome.started) await offerToCancel(sessions, ctx, outcome.active, ctx.user);
    });
  }

  // Any button that reached this point is from an older version of the bot or a dead screen.
  bot.on("callback_query", (ctx) => answerOutdated(ctx, hub));

  return { bot, hub, sessions };
}

export type BotApp = ReturnType<typeof createBot>;
