import { type ConnectionOptions, Queue, Worker } from "bullmq";
import type { Logger } from "../log";

export const VOICE_BACKFILL_QUEUE = "voice-backfill";

const SCHEDULER_ID = "voice-backfill";

export interface BullVoiceBackfillOptions {
  redisUrl: string;
  log: Logger;
  /** Minutes between runs; 0 turns the backfill off. */
  everyMinutes: number;
  /** Queue name; tests use a unique one so parallel runs do not share jobs. */
  queueName?: string;
}

/**
 * The voice backfill on its own BullMQ queue: one run every `everyMinutes`, one at a time. A run
 * takes minutes (uploads are spaced out), so it never shares a worker with the enrichment jobs.
 */
export class BullVoiceBackfill {
  private readonly queue: Queue;
  private worker?: Worker;
  private readonly connection: ConnectionOptions;
  private readonly queueName: string;

  constructor(private readonly options: BullVoiceBackfillOptions) {
    // BullMQ blocks on Redis and must not give up on commands: its own connections, no retry cap.
    this.connection = { url: options.redisUrl, maxRetriesPerRequest: null };
    this.queueName = options.queueName ?? VOICE_BACKFILL_QUEUE;
    this.queue = new Queue(this.queueName, { connection: this.connection });
  }

  /** Creates (or updates, or with `everyMinutes` 0 removes) the run's scheduler. */
  async schedule(): Promise<void> {
    if (this.options.everyMinutes > 0) {
      await this.queue.upsertJobScheduler(
        SCHEDULER_ID,
        { every: this.options.everyMinutes * 60_000 },
        {
          name: "voice-backfill",
          data: {},
          // A failed run is picked up by the next one; no retries needed.
          opts: { removeOnComplete: true, removeOnFail: 100, attempts: 1 },
        },
      );
    } else {
      await this.queue.removeJobScheduler(SCHEDULER_ID);
    }
  }

  startWorker(run: () => Promise<unknown>): void {
    if (this.worker) throw new Error("voice backfill worker already started");
    this.worker = new Worker(this.queueName, () => run(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on("failed", (_job, error) => {
      this.options.log.warn("voice backfill run failed", { error });
    });
    this.worker.on("error", (error) => {
      this.options.log.warn("voice backfill worker error", { error });
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue.close()]);
  }
}
