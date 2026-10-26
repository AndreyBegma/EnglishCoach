import { type ConnectionOptions, Queue, Worker } from "bullmq";
import type { Logger } from "../log";
import type { SessionTimeouts } from "../sessions/session-manager";

export const SESSION_TIMEOUT_QUEUE = "session-timeouts";

type TimeoutJob = { sessionId: number };

/** BullMQ forbids ':' in custom job IDs. */
const jobId = (sessionId: number) => `session-${sessionId}`;

export interface BullSessionTimeoutsOptions {
  redisUrl: string;
  delayMs: number;
  log: Logger;
  /** Queue name; tests use a unique one so parallel runs do not share jobs. */
  queueName?: string;
}

/**
 * Inactivity timeout as one delayed job per session. Activity replaces the job, so it fires only
 * after `delayMs` of silence; the worker then expires the session.
 */
export class BullSessionTimeouts implements SessionTimeouts {
  private readonly queue: Queue<TimeoutJob>;
  private worker?: Worker<TimeoutJob>;
  private readonly connection: ConnectionOptions;
  private readonly queueName: string;

  constructor(private readonly options: BullSessionTimeoutsOptions) {
    // BullMQ blocks on Redis and must not give up on commands: its own connections, no retry cap.
    this.connection = { url: options.redisUrl, maxRetriesPerRequest: null };
    this.queueName = options.queueName ?? SESSION_TIMEOUT_QUEUE;
    this.queue = new Queue<TimeoutJob>(this.queueName, { connection: this.connection });
  }

  async schedule(sessionId: number): Promise<void> {
    await this.queue.remove(jobId(sessionId));
    await this.queue.add(
      "expire",
      { sessionId },
      {
        jobId: jobId(sessionId),
        delay: this.options.delayMs,
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
      },
    );
  }

  async cancel(sessionId: number): Promise<void> {
    await this.queue.remove(jobId(sessionId));
  }

  /** Starts consuming due timeouts. `expire` must be idempotent: it may run more than once. */
  startWorker(expire: (sessionId: number) => Promise<unknown>): void {
    if (this.worker) throw new Error("session timeout worker already started");
    this.worker = new Worker<TimeoutJob>(
      this.queueName,
      async (job) => {
        await expire(job.data.sessionId);
      },
      { connection: this.connection },
    );
    this.worker.on("failed", (job, error) => {
      this.options.log.error("session timeout job failed", {
        sessionId: job?.data.sessionId,
        error,
      });
    });
    this.worker.on("error", (error) => {
      this.options.log.warn("session timeout worker error", { error });
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue.close()]);
  }
}
