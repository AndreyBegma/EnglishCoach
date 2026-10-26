import { webhookCallback } from "grammy";
import { createBot } from "./bot";
import { redisRefusalGate } from "./bot/access";
import type { FlowState } from "./bot/context";
import { redisStorage } from "./bot/storage";
import { EnvError, parseEnv } from "./config/env";
import { masterKeyFromBase64 } from "./crypto/secrets";
import { createDb } from "./db/client";
import { createApp } from "./http/app";
import { resolveProvider } from "./llm";
import { createLogger } from "./log";
import { BullSessionTimeouts } from "./queue/session-timeouts";
import { createRedis } from "./redis";
import {
  learnerContextFromDb,
  loadSkillRegistry,
  SkillDefinitionError,
  SkillRunner,
} from "./skills";

function loadEnvOrExit() {
  try {
    return parseEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      process.stderr.write(`Invalid environment: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

/** Loads `skills/` before anything connects: a broken skill file stops the boot. */
function loadSkillsOrExit() {
  try {
    return loadSkillRegistry();
  } catch (error) {
    if (error instanceof SkillDefinitionError) {
      process.stderr.write(`Invalid skills: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const env = loadEnvOrExit();
const log = createLogger({ level: env.LOG_LEVEL });
const skillRegistry = loadSkillsOrExit();
const masterKey = masterKeyFromBase64(env.MASTER_KEY);

const database = createDb(env.DATABASE_URL);
const skills = new SkillRunner({
  registry: skillRegistry,
  provider: (userId) => resolveProvider({ db: database.db, env, masterKey }, userId),
  learner: learnerContextFromDb(database.db),
});
const redis = createRedis(env.REDIS_URL);
let lastRedisError = "";
redis.client.on("error", (error: Error) => {
  // ioredis emits the same error on every reconnect attempt; log only when it changes.
  if (error.message === lastRedisError) return;
  lastRedisError = error.message;
  log.warn("redis error", { error });
});
redis.client.on("ready", () => {
  lastRedisError = "";
});

// Connect now: the client fails commands fast while disconnected, and the bot needs it per update.
redis.ping().catch((error: unknown) => log.warn("redis not reachable at startup", { error }));

const timeouts = new BullSessionTimeouts({
  redisUrl: env.REDIS_URL,
  delayMs: env.SESSION_TIMEOUT_MINUTES * 60_000,
  log,
});
const { bot, sessions } = createBot({
  token: env.TELEGRAM_BOT_TOKEN,
  db: database.db,
  log,
  adminIds: env.ADMIN_TELEGRAM_IDS,
  storage: redisStorage<FlowState>(redis.client),
  refusals: redisRefusalGate(redis.client),
  timeouts,
  enableDemoSession: env.ENABLE_DEMO_SESSION,
  masterKey,
  llmEnv: env,
  skills,
});
bot.catch((error) => log.error("bot update failed", { error: error.error }));
timeouts.startWorker((sessionId) => sessions.expire(sessionId));

const webhookSecret = env.BOT_MODE === "webhook" ? env.TELEGRAM_WEBHOOK_SECRET : undefined;
const app = createApp({
  checkDb: database.ping,
  checkRedis: redis.ping,
  telegramWebhook: webhookSecret
    ? {
        secret: webhookSecret,
        handler: webhookCallback(bot, "hono", { secretToken: webhookSecret }),
      }
    : undefined,
});
const server = Bun.serve({ port: env.HTTP_PORT, fetch: app.fetch });
log.info("http listening", { port: server.port });

if (webhookSecret && env.PUBLIC_URL) {
  const url = new URL(`/tg/${webhookSecret}`, env.PUBLIC_URL).toString();
  bot.api
    .setWebhook(url, { secret_token: webhookSecret })
    .then(() => log.info("bot webhook set", { host: new URL(url).host }))
    .catch((error: unknown) => log.error("bot webhook setup failed", { error }));
} else {
  bot
    .start({ onStart: (me) => log.info("bot polling", { username: me.username }) })
    .catch((error: unknown) => log.error("bot stopped", { error }));
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  await Promise.allSettled([bot.stop(), server.stop(), timeouts.close()]);
  await Promise.allSettled([database.close(), redis.close()]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
