import { createBot } from "./bot";
import { EnvError, parseEnv } from "./config/env";
import { createDb } from "./db/client";
import { createApp } from "./http/app";
import { createLogger } from "./log";
import { createRedis } from "./redis";

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

const env = loadEnvOrExit();
const log = createLogger({ level: env.LOG_LEVEL });

const database = createDb(env.DATABASE_URL);
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

const app = createApp({ checkDb: database.ping, checkRedis: redis.ping });
const server = Bun.serve({ port: env.HTTP_PORT, fetch: app.fetch });
log.info("http listening", { port: server.port });

const bot = createBot(env.TELEGRAM_BOT_TOKEN);
bot.catch((error) => log.error("bot update failed", { error: error.error }));
bot
  .start({ onStart: (me) => log.info("bot polling", { username: me.username }) })
  .catch((error: unknown) => log.error("bot stopped", { error }));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  await Promise.allSettled([bot.stop(), server.stop(), database.close(), redis.close()]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
