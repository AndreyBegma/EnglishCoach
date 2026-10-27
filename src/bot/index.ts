import { Bot, type BotConfig, type StorageAdapter, session } from "grammy";
import type { Db } from "../db/client";
import type { SessionKind } from "../db/repositories/sessions";
import { SettingsEvents } from "../events/settings-events";
import { grammarHandlers, grammarSession } from "../grammar";
import { answerOutdated, hubHandlers } from "../hub/handlers";
import { HubService } from "../hub/hub-service";
import type { WordImages } from "../images";
import type { ProviderFactories } from "../llm";
import type { ServerEnv } from "../llm/providers/server";
import type { Logger } from "../log";
import { OnboardingFlow } from "../onboarding/flow";
import { onboardingHandlers, placementSession } from "../onboarding/handlers";
import { progressHandlers } from "../progress";
import {
  MemoryRoutineJobs,
  MemoryRoutineStore,
  Routine,
  type RoutineJobs,
  type RoutineStore,
  routineHandlers,
} from "../routine";
import { demoSession } from "../sessions/demo";
import { offerToCancel, sessionMiddleware } from "../sessions/handlers";
import type { SessionLocks } from "../sessions/locks";
import { SessionManager, type SessionTimeouts } from "../sessions/session-manager";
import { SettingsController } from "../settings/controller";
import { settingsHandlers, settingsInputMiddleware } from "../settings/handlers";
import { ProviderSettings } from "../settings/provider";
import type { SkillRunner } from "../skills";
import { talkHandlers, talkSession } from "../talk";
import { vocabSessions } from "../vocab";
import { createVoice, type VoiceOptions } from "../voice";
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
  /** Pictures on new-word cards; absent when no stock-photo key is set. */
  images?: WordImages;
  /** Voice (STT/TTS) overrides; tests replace the HTTP client and the cache directory. */
  voice?: VoiceOptions;
  /** Tests pass `botInfo` here so the bot never calls getMe. */
  botConfig?: BotConfig<BotContext>;
  /** The daily routine's jobs and state (BullMQ and Redis in production; in memory otherwise). */
  routine?: { jobs: RoutineJobs; store: RoutineStore };
  /** The in-flight answer locks (Redis in production; in memory otherwise). */
  locks?: SessionLocks;
}

/**
 * Composes the bot. Middleware order matters: access (sets ctx.user/settings) → routine activity
 * (needs ctx.user) → i18n (reads
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
    locks: deps.locks,
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
  const vocab = vocabSessions({ db, i18n, skills: deps.skills, log, images: deps.images });
  sessions.register("vocab_new", vocab.learn);
  sessions.register("review", vocab.review);

  const routineJobs = deps.routine?.jobs ?? new MemoryRoutineJobs();
  const routineStore = deps.routine?.store ?? new MemoryRoutineStore();
  const routine = new Routine({
    api: bot.api,
    db,
    i18n,
    log,
    skills: deps.skills,
    sessions,
    jobs: routineJobs,
    store: routineStore,
    adminIds: deps.adminIds,
  });
  settingsEvents.on("settings.changed", (event) => routine.onSettingsChanged(event));
  sessions.onEnded((event) => routine.onSessionEnded(event));
  const voice = createVoice({
    db,
    api: bot.api,
    i18n,
    sessions,
    llmEnv: deps.llmEnv,
    masterKey: deps.masterKey,
    log,
    options: deps.voice,
  });

  bot.use(accessMiddleware({ db, adminIds: deps.adminIds, refusals: deps.refusals, i18n, log }));
  bot.use(routine.activity());
  bot.use(i18n);
  bot.use(session({ initial: (): FlowState => ({}), storage: deps.storage }));
  bot.use(settingsInputMiddleware(settings));
  bot.use(voice.stt);
  bot.use(sessionMiddleware(sessions));
  bot.use(adminCommands(db));
  bot.use(settingsHandlers(settings));
  bot.use(hubHandlers({ hub, sessions, onboarding }));
  bot.use(progressHandlers({ db, hub, sessions, i18n }));
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
  bot.use(voice.speak);
  bot.use(routineHandlers(routine));

  // Any button that reached this point is from an older version of the bot or a dead screen.
  bot.on("callback_query", (ctx) => answerOutdated(ctx, hub));

  return {
    bot,
    hub,
    sessions,
    settingsEvents,
    skills: deps.skills,
    routine,
    routineJobs,
    routineStore,
    voice,
  };
}

export type BotApp = ReturnType<typeof createBot>;
