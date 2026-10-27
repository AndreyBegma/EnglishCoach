import { afterAll, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { createLogger } from "../../src/log";
import { BullRoutineJobs, type RoutineJob } from "../../src/queue/routine-jobs";
import { RedisRoutineStore } from "../../src/routine";
import { slotSchedules } from "../../src/routine/time";

// Needs a real Redis: CI provides one; locally `docker compose up -d redis` and export REDIS_URL.
const redisUrl = process.env.REDIS_URL;
const log = createLogger({ write: () => {} });
const unique = () => `test-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!redisUrl)("routine jobs on BullMQ", () => {
  const closers: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    await Promise.all(closers.map((close) => close()));
  });

  function open() {
    const queueName = unique();
    const jobs = new BullRoutineJobs({ redisUrl: redisUrl ?? "", log, queueName });
    const queue = new Queue<RoutineJob>(queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
    });
    closers.push(
      () => jobs.close(),
      () => queue.close(),
    );
    return { jobs, queue };
  }

  const kyiv = slotSchedules({
    timezone: "Europe/Kyiv",
    morningTime: "08:30",
    eveningTime: "20:00",
  });

  test("one scheduler per slot with the pattern and time zone; upserting again replaces", async () => {
    const { jobs, queue } = open();
    await jobs.schedule(7, kyiv);
    await jobs.schedule(7, kyiv);

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => [s.key, s.pattern, s.tz]).sort()).toEqual([
      ["routine-7-evening", "0 20 * * *", "Europe/Kyiv"],
      ["routine-7-morning", "30 8 * * *", "Europe/Kyiv"],
      ["routine-7-reminder", "30 21 * * *", "Europe/Kyiv"],
    ]);

    await jobs.schedule(
      7,
      slotSchedules({ timezone: "Asia/Tokyo", morningTime: "07:00", eveningTime: "21:00" }),
    );
    const morning = await queue.getJobScheduler("routine-7-morning");
    expect([morning?.pattern, morning?.tz]).toEqual(["0 7 * * *", "Asia/Tokyo"]);
    expect(await queue.getJobSchedulersCount()).toBe(3);
  });

  test("unschedule drops the schedulers and a pending snooze, and leaves other users", async () => {
    const { jobs, queue } = open();
    await jobs.schedule(1, kyiv);
    await jobs.schedule(2, kyiv);
    await jobs.snooze(1, 1, 60_000);
    expect((await queue.getDelayed()).some((job) => job.id === "routine-snooze-1")).toBe(true);

    await jobs.unschedule(1);
    const keys = (await queue.getJobSchedulers()).map((s) => s.key).sort();
    expect(keys).toEqual(["routine-2-evening", "routine-2-morning", "routine-2-reminder"]);
    expect((await queue.getDelayed()).some((job) => job.id === "routine-snooze-1")).toBe(false);
  });

  test("the worker hands due jobs to fire", async () => {
    const { jobs } = open();
    const fired: RoutineJob[] = [];
    let notify: () => void = () => {};
    const next = new Promise<void>((resolve) => (notify = resolve));
    jobs.startWorker(async (job) => {
      fired.push(job);
      notify();
    });
    await jobs.snooze(3, 2, 10);
    await Promise.race([next, Bun.sleep(5_000)]);
    expect(fired).toEqual([{ userId: 3, slot: "morning", snoozes: 2 }]);
  });
});

describe.skipIf(!redisUrl)("routine state in Redis", () => {
  const client = new Redis(redisUrl ?? "", { lazyConnect: true });
  afterAll(() => client.quit());
  const store = new RedisRoutineStore(client);
  const userId = Math.floor(Math.random() * 1e9);

  test("a slot is claimed once per day until it is given back", async () => {
    expect(await store.claimSlot(userId, "morning", "2026-07-01")).toBe(true);
    expect(await store.claimSlot(userId, "morning", "2026-07-01")).toBe(false);
    expect(await store.claimSlot(userId, "morning", "2026-07-02")).toBe(true);
    expect(await store.claimSlot(userId, "evening", "2026-07-01")).toBe(true);
    await store.releaseSlot(userId, "morning", "2026-07-01");
    expect(await store.claimSlot(userId, "morning", "2026-07-01")).toBe(true);
  });

  test("prompt and blocked flag round-trip", async () => {
    await store.setPrompt(userId, { messageId: 42, slot: "evening", snoozes: 0 });
    expect(await store.getPrompt(userId)).toEqual({ messageId: 42, slot: "evening", snoozes: 0 });
    await store.clearPrompt(userId);
    expect(await store.getPrompt(userId)).toBeUndefined();

    await store.setBlocked(userId, true);
    expect(await store.isBlocked(userId)).toBe(true);
    await store.setBlocked(userId, false);
    expect(await store.isBlocked(userId)).toBe(false);
  });
});
