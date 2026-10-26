import { afterAll, describe, expect, test } from "bun:test";
import Redis from "ioredis";
import { redisRefusalGate } from "../../src/bot/access";
import { redisStorage } from "../../src/bot/storage";
import { createLogger } from "../../src/log";
import { BullSessionTimeouts } from "../../src/queue/session-timeouts";

// Needs a real Redis: CI provides one; locally `docker compose up -d redis` and export REDIS_URL.
const redisUrl = process.env.REDIS_URL;
const log = createLogger({ write: () => {} });
const unique = () => `test-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function waitFor<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([promise, Bun.sleep(ms).then(() => "timeout" as const)]);
}

describe.skipIf(!redisUrl)("session timeouts on BullMQ", () => {
  const opened: BullSessionTimeouts[] = [];
  afterAll(async () => {
    await Promise.all(opened.map((timeouts) => timeouts.close()));
  });

  function timeoutsWithWorker(delayMs: number) {
    const timeouts = new BullSessionTimeouts({
      redisUrl: redisUrl ?? "",
      delayMs,
      log,
      queueName: unique(),
    });
    opened.push(timeouts);
    const fired: { sessionId: number; at: number }[] = [];
    let notify: () => void = () => {};
    const next = () => new Promise<void>((resolve) => (notify = resolve));
    timeouts.startWorker(async (sessionId) => {
      fired.push({ sessionId, at: Date.now() });
      notify();
    });
    return { timeouts, fired, next };
  }

  test("expires a session after the delay", async () => {
    const { timeouts, fired, next } = timeoutsWithWorker(200);
    const firing = next();
    const scheduledAt = Date.now();
    await timeouts.schedule(41);

    expect(await waitFor(firing, 5_000)).not.toBe("timeout");
    expect(fired.map((f) => f.sessionId)).toEqual([41]);
    expect((fired[0]?.at ?? 0) - scheduledAt).toBeGreaterThanOrEqual(190);
  });

  test("activity restarts the countdown instead of adding a second one", async () => {
    const { timeouts, fired, next } = timeoutsWithWorker(400);
    const firing = next();
    await timeouts.schedule(42);
    await Bun.sleep(250);
    const touchedAt = Date.now();
    await timeouts.schedule(42);

    expect(await waitFor(firing, 5_000)).not.toBe("timeout");
    expect((fired[0]?.at ?? 0) - touchedAt).toBeGreaterThanOrEqual(390);
    await Bun.sleep(600);
    expect(fired.map((f) => f.sessionId)).toEqual([42]);
  });

  test("a cancelled countdown never fires", async () => {
    const { timeouts, fired } = timeoutsWithWorker(200);
    await timeouts.schedule(43);
    await timeouts.cancel(43);
    await Bun.sleep(700);
    expect(fired).toEqual([]);
  });
});

describe.skipIf(!redisUrl)("Redis-backed bot state", () => {
  const client = new Redis(redisUrl ?? "");
  afterAll(() => client.quit());

  test("grammY session storage round-trips and deletes", async () => {
    const storage = redisStorage<{ step: number }>(client, { prefix: `${unique()}:` });
    expect(await storage.read("42")).toBeUndefined();
    await storage.write("42", { step: 2 });
    expect(await storage.read("42")).toEqual({ step: 2 });
    await storage.delete("42");
    expect(await storage.read("42")).toBeUndefined();
  });

  test("the refusal gate lets one refusal through per Telegram ID", async () => {
    const gate = redisRefusalGate(client);
    const id = Math.floor(Math.random() * 1e12);
    try {
      expect(await gate.shouldNotify(id)).toBe(true);
      expect(await gate.shouldNotify(id)).toBe(false);
      expect(await client.ttl(`refused:${id}`)).toBeGreaterThan(24 * 60 * 60 - 10);
    } finally {
      await client.del(`refused:${id}`);
    }
  });
});
