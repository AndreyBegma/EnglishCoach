import { type ConnectionOptions, Queue, Worker } from "bullmq";
import type { Logger } from "../log";

export const WORD_ENRICHMENT_QUEUE = "word-enrichment";

export type WordEnrichmentJob =
  | { kind: "prefetch"; userId: number }
  | { kind: "prefetch-all" }
  | { kind: "backfill" };

export interface WordEnrichmentHandlers {
  prefetch(userId: number): Promise<unknown>;
  prefetchAll(): Promise<unknown>;
  backfill(): Promise<unknown>;
}

/** Nightly top-up for every learner, in UTC. */
const NIGHTLY_PATTERN = "15 3 * * *";
const NIGHTLY_ID = "word-prefetch-nightly";
const BACKFILL_ID = "word-backfill";
/** BullMQ forbids ':' in custom job IDs. */
const prefetchId = (userId: number) => `word-prefetch-${userId}`;

const JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: 100,
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
} as const;

export interface BullWordEnrichmentOptions {
  redisUrl: string;
  log: Logger;
  /** Jobs processed at once; each holds at most one LLM call open. */
  concurrency: number;
  /** Minutes between backfill runs; 0 turns backfill off. */
  backfillEveryMinutes: number;
  /** Queue name; tests use a unique one so parallel runs do not share jobs. */
  queueName?: string;
}

/**
 * The enrichment cache's jobs on one BullMQ queue: a prefetch per learner (after a Learn words
 * session and on a settings change — deduplicated while one is waiting), a nightly prefetch for
 * everyone, and a low-rate backfill of the rest of the owner's list.
 */
export class BullWordEnrichment {
  private readonly queue: Queue<WordEnrichmentJob>;
  private worker?: Worker<WordEnrichmentJob>;
  private readonly connection: ConnectionOptions;
  private readonly queueName: string;

  constructor(private readonly options: BullWordEnrichmentOptions) {
    // BullMQ blocks on Redis and must not give up on commands: its own connections, no retry cap.
    this.connection = { url: options.redisUrl, maxRetriesPerRequest: null };
    this.queueName = options.queueName ?? WORD_ENRICHMENT_QUEUE;
    this.queue = new Queue<WordEnrichmentJob>(this.queueName, { connection: this.connection });
  }

  /** Asks for one learner's prefetch; a request already waiting absorbs this one. */
  async requestPrefetch(userId: number): Promise<void> {
    await this.queue.add(
      "prefetch",
      { kind: "prefetch", userId },
      { ...JOB_OPTIONS, jobId: prefetchId(userId) },
    );
  }

  /** Creates (or updates) the nightly prefetch and the backfill schedulers. */
  async schedule(): Promise<void> {
    await this.queue.upsertJobScheduler(
      NIGHTLY_ID,
      { pattern: NIGHTLY_PATTERN, tz: "UTC" },
      { name: "prefetch-all", data: { kind: "prefetch-all" }, opts: JOB_OPTIONS },
    );
    if (this.options.backfillEveryMinutes > 0) {
      await this.queue.upsertJobScheduler(
        BACKFILL_ID,
        { every: this.options.backfillEveryMinutes * 60_000 },
        // A failed slice is picked up by the next run; no retries needed.
        { name: "backfill", data: { kind: "backfill" }, opts: { ...JOB_OPTIONS, attempts: 1 } },
      );
    } else {
      await this.queue.removeJobScheduler(BACKFILL_ID);
    }
  }

  startWorker(handlers: WordEnrichmentHandlers): void {
    if (this.worker) throw new Error("word enrichment worker already started");
    this.worker = new Worker<WordEnrichmentJob>(
      this.queueName,
      async (job) => {
        const data = job.data;
        switch (data.kind) {
          case "prefetch":
            return handlers.prefetch(data.userId);
          case "prefetch-all":
            return handlers.prefetchAll();
          case "backfill":
            return handlers.backfill();
        }
      },
      { connection: this.connection, concurrency: this.options.concurrency },
    );
    this.worker.on("failed", (job, error) => {
      this.options.log.warn("word enrichment job failed", { job: job?.name, error });
    });
    this.worker.on("error", (error) => {
      this.options.log.warn("word enrichment worker error", { error });
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue.close()]);
  }
}
