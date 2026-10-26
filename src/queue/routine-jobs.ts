import { type ConnectionOptions, Queue, Worker } from "bullmq";
import type { Logger } from "../log";
import type { RoutineJobs } from "../routine/ports";
import { ROUTINE_SLOTS, type RoutineSlot, type SlotSchedule } from "../routine/time";

export const ROUTINE_QUEUE = "routine";

export type RoutineJob = { userId: number; slot: RoutineSlot; snoozes?: number };

/** BullMQ forbids ':' in custom job IDs. */
const schedulerId = (userId: number, slot: RoutineSlot) => `routine-${userId}-${slot}`;
const snoozeId = (userId: number) => `routine-snooze-${userId}`;

const JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: 100,
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
} as const;

export interface BullRoutineJobsOptions {
  redisUrl: string;
  log: Logger;
  /** Queue name; tests use a unique one so parallel runs do not share jobs. */
  queueName?: string;
}

/**
 * The daily routine as one BullMQ job scheduler per (user, slot): a cron pattern evaluated in the
 * learner's IANA time zone, so the wall-clock time holds across DST changes. A morning snooze is
 * a single delayed job.
 */
export class BullRoutineJobs implements RoutineJobs {
  private readonly queue: Queue<RoutineJob>;
  private worker?: Worker<RoutineJob>;
  private readonly connection: ConnectionOptions;
  private readonly queueName: string;

  constructor(private readonly options: BullRoutineJobsOptions) {
    // BullMQ blocks on Redis and must not give up on commands: its own connections, no retry cap.
    this.connection = { url: options.redisUrl, maxRetriesPerRequest: null };
    this.queueName = options.queueName ?? ROUTINE_QUEUE;
    this.queue = new Queue<RoutineJob>(this.queueName, { connection: this.connection });
  }

  async schedule(userId: number, slots: readonly SlotSchedule[]): Promise<void> {
    for (const { slot, pattern, tz } of slots) {
      await this.queue.upsertJobScheduler(
        schedulerId(userId, slot),
        { pattern, tz },
        { name: slot, data: { userId, slot }, opts: JOB_OPTIONS },
      );
    }
  }

  async unschedule(userId: number): Promise<void> {
    for (const slot of ROUTINE_SLOTS) {
      await this.queue.removeJobScheduler(schedulerId(userId, slot));
    }
    await this.queue.remove(snoozeId(userId));
  }

  async snooze(userId: number, snoozes: number, delayMs: number): Promise<void> {
    await this.queue.remove(snoozeId(userId));
    await this.queue.add(
      "morning",
      { userId, slot: "morning", snoozes },
      { ...JOB_OPTIONS, jobId: snoozeId(userId), delay: delayMs },
    );
  }

  /** Starts consuming due routine jobs. `fire` must be idempotent: it may run more than once. */
  startWorker(fire: (job: RoutineJob) => Promise<unknown>): void {
    if (this.worker) throw new Error("routine worker already started");
    this.worker = new Worker<RoutineJob>(
      this.queueName,
      async (job) => {
        await fire(job.data);
      },
      { connection: this.connection },
    );
    this.worker.on("failed", (job, error) => {
      this.options.log.error("routine job failed", {
        userId: job?.data.userId,
        slot: job?.data.slot,
        error,
      });
    });
    this.worker.on("error", (error) => {
      this.options.log.warn("routine worker error", { error });
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue.close()]);
  }
}
