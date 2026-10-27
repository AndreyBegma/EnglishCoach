import { type ConnectionOptions, Queue, Worker } from "bullmq";
import type { Logger } from "../log";

export const FSRS_OPTIMISER_QUEUE = "fsrs-optimiser";

export type FsrsOptimiserJob = { kind: "sweep" } | { kind: "optimise"; userId: number };

export interface FsrsOptimiserHandlers {
  /** Learners whose run is due now (`usersDueForOptimisation`). */
  dueUsers(): Promise<number[]>;
  /** One learner's run (`optimise`). */
  optimise(userId: number): Promise<unknown>;
}

/** Daily, in UTC, at a quiet hour: finds learners due a run. */
const SWEEP_PATTERN = "40 3 * * *";
const SWEEP_ID = "fsrs-optimiser-sweep";
/** BullMQ forbids ':' in custom job IDs. */
const optimiseId = (userId: number) => `fsrs-optimise-${userId}`;

const JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: 100,
  attempts: 2,
  backoff: { type: "exponential", delay: 60_000 },
} as const;

export interface BullFsrsOptimiserOptions {
  redisUrl: string;
  log: Logger;
  /** Queue name; tests use a unique one so parallel runs do not share jobs. */
  queueName?: string;
}

/**
 * The FSRS optimiser on one BullMQ queue: a daily sweep that enqueues one run per learner due
 * (deduplicated while one is waiting), and the runs themselves, one at a time — a fit is CPU work.
 */
export class BullFsrsOptimiser {
  private readonly queue: Queue<FsrsOptimiserJob>;
  private worker?: Worker<FsrsOptimiserJob>;
  private readonly connection: ConnectionOptions;
  private readonly queueName: string;

  constructor(private readonly options: BullFsrsOptimiserOptions) {
    // BullMQ blocks on Redis and must not give up on commands: its own connections, no retry cap.
    this.connection = { url: options.redisUrl, maxRetriesPerRequest: null };
    this.queueName = options.queueName ?? FSRS_OPTIMISER_QUEUE;
    this.queue = new Queue<FsrsOptimiserJob>(this.queueName, { connection: this.connection });
  }

  /** Asks for one learner's run; a run already waiting absorbs this one. */
  async requestOptimise(userId: number): Promise<void> {
    await this.queue.add(
      "optimise",
      { kind: "optimise", userId },
      { ...JOB_OPTIONS, jobId: optimiseId(userId) },
    );
  }

  /** Creates (or updates) the daily sweep. */
  async schedule(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_ID,
      { pattern: SWEEP_PATTERN, tz: "UTC" },
      { name: "sweep", data: { kind: "sweep" }, opts: JOB_OPTIONS },
    );
  }

  startWorker(handlers: FsrsOptimiserHandlers): void {
    if (this.worker) throw new Error("fsrs optimiser worker already started");
    this.worker = new Worker<FsrsOptimiserJob>(
      this.queueName,
      async (job) => {
        const data = job.data;
        switch (data.kind) {
          case "sweep":
            for (const userId of await handlers.dueUsers()) await this.requestOptimise(userId);
            return;
          case "optimise":
            return handlers.optimise(data.userId);
        }
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on("failed", (job, error) => {
      this.options.log.warn("fsrs optimiser job failed", { job: job?.name, error });
    });
    this.worker.on("error", (error) => {
      this.options.log.warn("fsrs optimiser worker error", { error });
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue.close()]);
  }
}
