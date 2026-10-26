import { Bot, type BotConfig, type StorageAdapter, session } from "grammy";
import type { Db } from "../db/client";
import type { SessionKind } from "../db/repositories/sessions";
import { SettingsEvents } from "../events/settings-events";
import { grammarHandlers, grammarSession } from "../grammar";
import { answerOutdated, hubHandlers } from "../hub/handlers";
import { HubService } from "../hub/hub-service";
import type { ProviderFactories } from "../llm";
import type { ServerEnv } from "../llm/providers/server";
import type { Logger } from "../log";
import { OnboardingFlow } from "../onboarding/flow";
import { onboardingHandlers, placementSession } from "../onboarding/handlers";
import { demoSession } from "../sessions/demo";
import { offerToCancel, sessionMiddleware } from "../sessions/handlers";
import { SessionManager, type SessionTimeouts } from "../sessions/session-manager";
import { SettingsController } from "../settings/controller";
import { settingsHandlers, settingsInputMiddleware } from "../settings/handlers";
import { ProviderSettings } from "../settings/provider";
import type { SkillRunner } from "../skills";
import { talkHandlers, talkSession } from "../talk";
import { vocabSessions } from "../vocab";
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
  /** Session kinds whose `sessions.register` is ignored; tests use it to get a kind with no handler. */
  withoutSessionKinds?: readonly SessionKind[];
  /** Decrypts and encrypts user API keys. */
  masterKey: Buffer;
  /** The server provider's environment (`SERVER_*`, `CLAUDE_BIN`). */
  llmEnv: ServerEnv;
  /** Tests replace the SDK-backed providers. */
  llmFactories?: ProviderFactories;
  /** Runs skills for session handlers (one runner per process). */
  skills: SkillRunner;
  /** Tests pass `botInfo` here so the bot never calls getMe. */
  botConfig?: BotConfig<BotContext>;
}

/**
 * Composes the bot. Middleware order matters: access (sets ctx.user/settings) → i18n (reads
 * ctx.settings) → grammY session → pending settings input → learning session → admin →
 * settings → hub → fallbacks.
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

  const skippedKinds = new Set(deps.withoutSessionKinds);
  const registerKind = sessions.register.bind(sessions);
  sessions.register = (kind, handler) => {
    if (!skippedKinds.has(kind)) registerKind(kind, handler);
  };

  const settingsEvents = new SettingsEvents(log);
  const providers = new ProviderSettings({
    db,
    env: deps.llmEnv,
    masterKey: deps.masterKey,
    factories: deps.llmFactories,
    log,
  });
  const settings = {
    hub,
    controller: new SettingsController({
      db,
      hub,
      i18n,
      events: settingsEvents,
      providers,
      placement: { retake: (ctx) => onboarding.retake(ctx) },
    }),
    log,
  };
  const onboarding = new OnboardingFlow({
    db,
    i18n,
    skills: deps.skills,
    sessions,
    events: settingsEvents,
    hub,
    log,
    openProviderSettings: (ctx) => settings.controller.show(ctx, { page: "provider" }),
  });

  const talk = { db, skills: deps.skills, i18n, log };
  sessions.register("talk", deps.enableDemoSession ? demoSession(i18n) : talkSession(talk));
  const grammar = { db, skills: deps.skills, i18n, log };
  sessions.register("grammar", grammarSession(grammar));
  sessions.register("placement", placementSession);
  const vocab = vocabSessions({ db, i18n, skills: deps.skills, log });
  sessions.register("vocab_new", vocab.learn);
  sessions.register("review", vocab.review);

  bot.use(accessMiddleware({ db, adminIds: deps.adminIds, refusals: deps.refusals, i18n, log }));
  bot.use(i18n);
  bot.use(session({ initial: (): FlowState => ({}), storage: deps.storage }));
  bot.use(settingsInputMiddleware(settings));
  bot.use(sessionMiddleware(sessions));
  bot.use(adminCommands(db));
  bot.use(settingsHandlers(settings));
  bot.use(hubHandlers({ hub, sessions, onboarding }));
  bot.use(talkHandlers(talk));
  bot.use(grammarHandlers(grammar));
  bot.use(onboardingHandlers(onboarding));

  if (deps.enableDemoSession) {
    bot.command("demo", async (ctx) => {
      if (!ctx.learning) await ctx.deleteMessage().catch(() => {});
      const outcome = await sessions.start(ctx.user, "talk");
      if (!outcome.started) await offerToCancel(sessions, ctx, outcome.active, ctx.user);
    });
  }

  bot.use(vocab.composer);

  // Any button that reached this point is from an older version of the bot or a dead screen.
  bot.on("callback_query", (ctx) => answerOutdated(ctx, hub));

  return { bot, hub, sessions, settingsEvents, skills: deps.skills };
}

export type BotApp = ReturnType<typeof createBot>;
