import type Redis from "ioredis";
import type { RoutinePrompt, RoutineStore } from "./ports";
import type { RoutineSlot } from "./time";

/** A slot's claim outlives its local day in every time zone (UTC−12 … UTC+14). */
const CLAIM_TTL_SECONDS = 48 * 60 * 60;
/** A prompt older than this cannot be deleted by the bot anyway (Telegram's 48 h limit). */
const PROMPT_TTL_SECONDS = 48 * 60 * 60;

/** Routine state in Redis under `routine:*`. */
export class RedisRoutineStore implements RoutineStore {
  constructor(private readonly client: Redis) {}

  async claimSlot(userId: number, slot: RoutineSlot, date: string) {
    const reply = await this.client.set(
      `routine:sent:${userId}:${slot}:${date}`,
      "1",
      "EX",
      CLAIM_TTL_SECONDS,
      "NX",
    );
    return reply === "OK";
  }

  async releaseSlot(userId: number, slot: RoutineSlot, date: string) {
    await this.client.del(`routine:sent:${userId}:${slot}:${date}`);
  }

  async getPrompt(userId: number) {
    const value = await this.client.get(`routine:prompt:${userId}`);
    return value === null ? undefined : (JSON.parse(value) as RoutinePrompt);
  }

  async setPrompt(userId: number, prompt: RoutinePrompt) {
    await this.client.set(
      `routine:prompt:${userId}`,
      JSON.stringify(prompt),
      "EX",
      PROMPT_TTL_SECONDS,
    );
  }

  async clearPrompt(userId: number) {
    await this.client.del(`routine:prompt:${userId}`);
  }

  async isBlocked(userId: number) {
    return (await this.client.exists(`routine:blocked:${userId}`)) === 1;
  }

  async setBlocked(userId: number, blocked: boolean) {
    if (blocked) await this.client.set(`routine:blocked:${userId}`, "1");
    else await this.client.del(`routine:blocked:${userId}`);
  }
}
