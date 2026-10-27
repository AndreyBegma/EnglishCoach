import { afterAll, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import { createLogger } from "../../src/log";
import { BullWordEnrichment, type WordEnrichmentJob } from "../../src/queue/word-enrichment";

// Needs a real Redis: CI provides one; locally `docker compose up -d redis` and export REDIS_URL.
const redisUrl = process.env.REDIS_URL;
const log = createLogger({ write: () => {} });
const unique = () => `test-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!redisUrl)("word enrichment jobs on BullMQ", () => {
  const closers: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    await Promise.all(closers.map((close) => close()));
  });

  function open(backfillEveryMinutes = 30) {
    const queueName = unique();
    const jobs = new BullWordEnrichment({
      redisUrl: redisUrl ?? "",
      log,
      concurrency: 1,
      backfillEveryMinutes,
      queueName,
    });
    const queue = new Queue<WordEnrichmentJob>(queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
    });
    closers.push(
      () => jobs.close(),
      () => queue.close(),
    );
    return { jobs, queue };
  }

  test("a waiting prefetch absorbs further requests for the same learner", async () => {
    const { jobs, queue } = open();
    await jobs.requestPrefetch(7);
    await jobs.requestPrefetch(7);
    await jobs.requestPrefetch(8);
    const waiting = await queue.getWaiting();
    expect(
      waiting
        .map((job) => job.data)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual([
      { kind: "prefetch", userId: 7 },
      { kind: "prefetch", userId: 8 },
    ]);
  });

  test("nightly prefetch and backfill schedulers; backfill 0 removes it", async () => {
    const { jobs, queue } = open(15);
    await jobs.schedule();
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => [s.key, s.pattern ?? null, s.every ?? null]).sort()).toEqual([
      ["word-backfill", null, 900_000],
      ["word-prefetch-nightly", "15 3 * * *", null],
    ]);

    const off = new BullWordEnrichment({
      redisUrl: redisUrl ?? "",
      log,
      concurrency: 1,
      backfillEveryMinutes: 0,
      queueName: queue.name,
    });
    closers.push(() => off.close());
    await off.schedule();
    expect((await queue.getJobSchedulers()).map((s) => s.key)).toEqual(["word-prefetch-nightly"]);
  });

  test("the worker routes each job to its handler", async () => {
    const { jobs } = open();
    const seen: string[] = [];
    const done = new Promise<void>((resolve) => {
      jobs.startWorker({
        prefetch: async (userId) => {
          seen.push(`prefetch ${userId}`);
          resolve();
        },
        prefetchAll: async () => seen.push("all"),
        backfill: async () => seen.push("backfill"),
      });
    });
    await jobs.requestPrefetch(42);
    await done;
    expect(seen).toEqual(["prefetch 42"]);
  });
});
