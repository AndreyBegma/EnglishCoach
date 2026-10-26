import { type Context, Hono } from "hono";

export type Probe = () => Promise<void>;

export interface AppDeps {
  checkDb: Probe;
  checkRedis: Probe;
  /** How long a single probe may take before it counts as down. */
  probeTimeoutMs?: number;
  /** Mounted at `POST /tg/<secret>` in webhook mode. */
  telegramWebhook?: { secret: string; handler: (c: Context) => Promise<Response> };
}

async function isUp(probe: Probe, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("probe timed out")), timeoutMs);
  });
  try {
    await Promise.race([probe(), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createApp({
  checkDb,
  checkRedis,
  probeTimeoutMs = 1000,
  telegramWebhook,
}: AppDeps) {
  const app = new Hono();

  if (telegramWebhook) app.post(`/tg/${telegramWebhook.secret}`, telegramWebhook.handler);

  app.get("/health", async (c) => {
    const [db, redis] = await Promise.all([
      isUp(checkDb, probeTimeoutMs),
      isUp(checkRedis, probeTimeoutMs),
    ]);
    const ok = db && redis;
    return c.json({ ok, db, redis }, ok ? 200 : 503);
  });

  return app;
}
