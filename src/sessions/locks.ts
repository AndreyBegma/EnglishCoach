import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

/**
 * How long a session lock lives when its holder never releases it (a crashed process). Longer
 * than the slowest LLM call (the claude-code provider gives up after 120 s), so a lock does not
 * expire under a call that is still running.
 */
export const LOCK_TTL_MS = 150_000;

/** How long the last hold of a lock is remembered, for updates that queued up behind it. */
export const HELD_TTL_MS = 60_000;

/** One hold of a lock: from when it was taken to when it was released, in ms since the epoch. */
export interface HeldWindow {
  from: number;
  to: number;
}

export interface LockLease {
  /**
   * Releases the lock if this lease still holds it; safe to call more than once. The hold becomes
   * `lastHeld` unless `record` is false (a hold that did no work).
   */
  release(options?: { record?: boolean }): Promise<void>;
}

/**
 * Short-lived per-key locks: one answer of a session is graded and the next item prepared at a
 * time. Redis in production, so several bot processes share them; in memory otherwise.
 */
export interface SessionLocks {
  /** Takes the lock of `key` for at most `ttlMs`; null when it is held. */
  acquire(key: string, ttlMs?: number): Promise<LockLease | null>;
  /** The last released hold of `key`, while it is remembered. */
  lastHeld(key: string): Promise<HeldWindow | undefined>;
}

/**
 * True when a message Telegram dated `dateSeconds` arrived while `held` was in force. Telegram
 * dates have one-second resolution, so both ends are taken conservatively: a message from the
 * second the lock was released counts as arriving after it.
 */
export function arrivedWhileHeld(dateSeconds: number, held: HeldWindow | undefined): boolean {
  if (!held) return false;
  return dateSeconds * 1000 >= held.from && (dateSeconds + 1) * 1000 <= held.to;
}

/** In-process locks; correct for one bot process. */
export class MemorySessionLocks implements SessionLocks {
  private readonly held = new Map<string, { token: string; from: number; until: number }>();
  private readonly released = new Map<string, HeldWindow & { until: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async acquire(key: string, ttlMs = LOCK_TTL_MS): Promise<LockLease | null> {
    const at = this.now();
    const current = this.held.get(key);
    if (current && current.until > at) return null;
    const token = randomUUID();
    this.held.set(key, { token, from: at, until: at + ttlMs });
    return {
      release: async ({ record = true } = {}) => {
        const mine = this.held.get(key);
        if (mine?.token !== token) return;
        this.held.delete(key);
        if (!record) return;
        const to = this.now();
        this.released.set(key, { from: mine.from, to, until: to + HELD_TTL_MS });
      },
    };
  }

  async lastHeld(key: string): Promise<HeldWindow | undefined> {
    const window = this.released.get(key);
    if (!window || window.until <= this.now()) return undefined;
    return { from: window.from, to: window.to };
  }
}

/** Deletes the lock only if it still carries the caller's token, then records the hold (ARGV[5]). */
const RELEASE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  redis.call("del", KEYS[1])
  if ARGV[5] == "1" then
    redis.call("set", KEYS[2], ARGV[2] .. ":" .. ARGV[3], "PX", ARGV[4])
  end
  return 1
end
return 0`;

/** Locks under `lock:*`, their last holds under `lock-held:*`. */
export class RedisSessionLocks implements SessionLocks {
  constructor(
    private readonly client: Pick<Redis, "set" | "get" | "eval">,
    private readonly now: () => number = Date.now,
  ) {}

  async acquire(key: string, ttlMs = LOCK_TTL_MS): Promise<LockLease | null> {
    const token = randomUUID();
    const reply = await this.client.set(`lock:${key}`, token, "PX", ttlMs, "NX");
    if (reply !== "OK") return null;
    const from = this.now();
    return {
      release: async ({ record = true } = {}) => {
        await this.client.eval(
          RELEASE,
          2,
          `lock:${key}`,
          `lock-held:${key}`,
          token,
          String(from),
          String(this.now()),
          String(HELD_TTL_MS),
          record ? "1" : "0",
        );
      },
    };
  }

  async lastHeld(key: string): Promise<HeldWindow | undefined> {
    const value = await this.client.get(`lock-held:${key}`);
    const [from, to] = (value ?? "").split(":").map(Number);
    return from !== undefined && to !== undefined && Number.isFinite(from) && Number.isFinite(to)
      ? { from, to }
      : undefined;
  }
}
