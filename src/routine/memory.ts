import type { RoutineJobs, RoutinePrompt, RoutineStore } from "./ports";
import type { RoutineSlot, SlotSchedule } from "./time";

/**
 * In-process routine state and jobs that only record what was asked. The bot falls back to them
 * when no Redis-backed ones are passed (tests); nothing fires by itself.
 */
export class MemoryRoutineStore implements RoutineStore {
  readonly claims = new Set<string>();
  readonly prompts = new Map<number, RoutinePrompt>();
  readonly blocked = new Set<number>();

  async claimSlot(userId: number, slot: RoutineSlot, date: string) {
    const key = `${userId}:${slot}:${date}`;
    if (this.claims.has(key)) return false;
    this.claims.add(key);
    return true;
  }
  async releaseSlot(userId: number, slot: RoutineSlot, date: string) {
    this.claims.delete(`${userId}:${slot}:${date}`);
  }
  async getPrompt(userId: number) {
    return this.prompts.get(userId);
  }
  async setPrompt(userId: number, prompt: RoutinePrompt) {
    this.prompts.set(userId, prompt);
  }
  async clearPrompt(userId: number) {
    this.prompts.delete(userId);
  }
  async isBlocked(userId: number) {
    return this.blocked.has(userId);
  }
  async setBlocked(userId: number, blocked: boolean) {
    if (blocked) this.blocked.add(userId);
    else this.blocked.delete(userId);
  }
}

export class MemoryRoutineJobs implements RoutineJobs {
  readonly scheduled = new Map<number, readonly SlotSchedule[]>();
  readonly snoozed: { userId: number; snoozes: number; delayMs: number }[] = [];

  async schedule(userId: number, slots: readonly SlotSchedule[]) {
    this.scheduled.set(userId, slots);
  }
  async unschedule(userId: number) {
    this.scheduled.delete(userId);
  }
  async snooze(userId: number, snoozes: number, delayMs: number) {
    this.snoozed.push({ userId, snoozes, delayMs });
  }
}
