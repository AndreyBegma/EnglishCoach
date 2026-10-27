import { afterAll, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import { createLogger } from "../../src/log";
import { BullFsrsOptimiser, type FsrsOptimiserJob } from "../../src/queue/fsrs-optimiser";

// Needs a real Redis: CI provides one; locally `docker compose up -d redis` and export REDIS_URL.
const redisUrl = process.env.REDIS_URL;
const log = createLogger({ write: () => {} });
const unique = () => `test-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!redisUrl)("FSRS optimiser jobs on BullMQ", () => {
  const closers: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    await Promise.all(closers.map((close) => close()));
  });

  function open() {
    const queueName = unique();
    const jobs = new BullFsrsOptimiser({ redisUrl: redisUrl ?? "", log, queueName });
    const queue = new Queue<FsrsOptimiserJob>(queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
    });
    closers.push(
      () => jobs.close(),
      () => queue.close(),
    );
    return { jobs, queue };
  }

  test("a waiting run absorbs further requests for the same learner", async () => {
    const { jobs, queue } = open();
    await jobs.requestOptimise(7);
    await jobs.requestOptimise(7);
    await jobs.requestOptimise(8);
    const waiting = (await queue.getWaiting()).map((job) => job.data);
    expect(waiting.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual([
      { kind: "optimise", userId: 7 },
      { kind: "optimise", userId: 8 },
    ]);
  });

  test("a daily sweep in UTC", async () => {
    const { jobs, queue } = open();
    await jobs.schedule();
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => [s.key, s.pattern, s.tz])).toEqual([
      ["fsrs-optimiser-sweep", "40 3 * * *", "UTC"],
    ]);
  });

  test("the sweep enqueues a run per learner due, and the worker runs each", async () => {
    const { jobs, queue } = open();
    const optimised: number[] = [];
    const done = new Promise<void>((resolve) => {
      jobs.startWorker({
        dueUsers: async () => [3, 5],
        optimise: async (userId) => {
          optimised.push(userId);
          if (optimised.length === 2) resolve();
        },
      });
    });
    await queue.add("sweep", { kind: "sweep" });
    await done;
    expect(optimised.sort()).toEqual([3, 5]);
  });
});
