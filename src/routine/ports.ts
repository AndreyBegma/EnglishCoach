import type { RoutineSlot, SlotSchedule } from "./time";

/** The per-user daily jobs. Implemented by BullMQ job schedulers in production. */
export interface RoutineJobs {
  /** Creates or replaces the user's daily jobs, one per slot. Idempotent. */
  schedule(userId: number, slots: readonly SlotSchedule[]): Promise<void>;
  /** Drops every daily job of the user, and a pending snooze. */
  unschedule(userId: number): Promise<void>;
  /** Re-sends the morning prompt once after `delayMs`; `snoozes` counts this one. */
  snooze(userId: number, snoozes: number, delayMs: number): Promise<void>;
}

/** The routine message currently in the chat, so the next one (or acting on it) removes it. */
export interface RoutinePrompt {
  messageId: number;
  slot: RoutineSlot;
  /** How many times the morning prompt has been put off already. */
  snoozes: number;
}

/** Small routine state that must survive restarts and be shared by bot and worker (Redis). */
export interface RoutineStore {
  /**
   * Claims the one unsolicited message of (user, slot, local date). False when it was claimed
   * already — a second fire of the same slot (a retry, a rescheduled job) sends nothing.
   */
  claimSlot(userId: number, slot: RoutineSlot, date: string): Promise<boolean>;
  /** Gives a claim back when the message could not be sent for a reason worth retrying. */
  releaseSlot(userId: number, slot: RoutineSlot, date: string): Promise<void>;
  /**
   * Counts one unsolicited message against the learner's local `date`, atomically; false (and
   * nothing counted) when `cap` were counted already.
   */
  reserveNotification(userId: number, date: string, cap: number): Promise<boolean>;
  /** Takes back one count of `date`, for a message that was not sent after all. */
  releaseNotification(userId: number, date: string): Promise<void>;
  getPrompt(userId: number): Promise<RoutinePrompt | undefined>;
  setPrompt(userId: number, prompt: RoutinePrompt): Promise<void>;
  clearPrompt(userId: number): Promise<void>;
  /** Set when Telegram says the user blocked the bot; cleared when they write again. */
  isBlocked(userId: number): Promise<boolean>;
  setBlocked(userId: number, blocked: boolean): Promise<void>;
}
