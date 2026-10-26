import { describe, expect, test } from "bun:test";
import { createApp, type Probe } from "../src/http/app";

const up: Probe = async () => {};
const down: Probe = async () => {
  throw new Error("connection refused");
};
const hangs: Probe = () => new Promise(() => {});

async function health(checkDb: Probe, checkRedis: Probe) {
  const app = createApp({ checkDb, checkRedis, probeTimeoutMs: 50 });
  const response = await app.request("/health");
  return { status: response.status, body: await response.json() };
}

describe("GET /health", () => {
  test("200 with db and redis true when both answer", async () => {
    expect(await health(up, up)).toEqual({
      status: 200,
      body: { ok: true, db: true, redis: true },
    });
  });

  test("503 when the database is down", async () => {
    expect(await health(down, up)).toEqual({
      status: 503,
      body: { ok: false, db: false, redis: true },
    });
  });

  test("503 when redis does not answer in time", async () => {
    expect(await health(up, hangs)).toEqual({
      status: 503,
      body: { ok: false, db: true, redis: false },
    });
  });
});

describe("POST /tg/<secret>", () => {
  const secret = "s".repeat(32);

  test("is served by the Telegram webhook handler in webhook mode", async () => {
    const app = createApp({
      checkDb: up,
      checkRedis: up,
      telegramWebhook: { secret, handler: (c) => Promise.resolve(c.text("handled")) },
    });
    const response = await app.request(`/tg/${secret}`, { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("handled");
    expect((await app.request("/tg/wrong", { method: "POST" })).status).toBe(404);
  });

  test("does not exist in polling mode", async () => {
    const app = createApp({ checkDb: up, checkRedis: up });
    expect((await app.request(`/tg/${secret}`, { method: "POST" })).status).toBe(404);
  });
});
