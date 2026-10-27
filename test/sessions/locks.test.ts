import { afterAll, describe, expect, test } from "bun:test";
import Redis from "ioredis";
import {
  arrivedWhileHeld,
  HELD_TTL_MS,
  MemorySessionLocks,
  RedisSessionLocks,
  type SessionLocks,
} from "../../src/sessions/locks";

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

interface Subject {
  locks: SessionLocks;
  time: ReturnType<typeof clock>;
  /** Lets `ms` pass for the lock's TTL: the fake clock for memory, real time for Redis. */
  expire(ms: number): Promise<void>;
  /** A key no other test uses. */
  key(name: string): string;
}

/** The behaviour both implementations share. */
function sharedContract(subject: Subject) {
  const { locks, time, expire, key } = subject;

  test("one holder at a time; released, the lock is free again", async () => {
    const k = key("one");
    const lease = await locks.acquire(k);
    expect(lease).not.toBeNull();
    expect(await locks.acquire(k)).toBeNull();
    const other = await locks.acquire(key("other"));
    expect(other).not.toBeNull();
    await lease?.release();
    const again = await locks.acquire(k);
    expect(again).not.toBeNull();
    await again?.release();
    await other?.release();
  });

  test("a released hold is remembered as the last one; an unrecorded release is not", async () => {
    const k = key("held");
    const lease = await locks.acquire(k);
    const from = time.now();
    time.advance(2_500);
    await lease?.release();
    expect(await locks.lastHeld(k)).toEqual({ from, to: from + 2_500 });

    time.advance(100);
    const idle = await locks.acquire(k);
    await idle?.release({ record: false });
    expect(await locks.lastHeld(k)).toEqual({ from, to: from + 2_500 });
  });

  test("a holder that never releases loses the lock after its TTL", async () => {
    const k = key("ttl");
    expect(await locks.acquire(k, 40)).not.toBeNull();
    expect(await locks.acquire(k)).toBeNull();
    await expire(60);
    const lease = await locks.acquire(k);
    expect(lease).not.toBeNull();
    await lease?.release();
  });

  test("an expired lease cannot release the lock a later holder took", async () => {
    const k = key("stale");
    const first = await locks.acquire(k, 40);
    await expire(60);
    const second = await locks.acquire(k);
    expect(second).not.toBeNull();
    await first?.release();
    expect(await locks.acquire(k)).toBeNull();
    await second?.release();
  });
}

describe("MemorySessionLocks", () => {
  const time = clock();
  sharedContract({
    locks: new MemorySessionLocks(time.now),
    time,
    expire: async (ms) => void time.advance(ms),
    key: (name) => name,
  });

  test("the last hold is forgotten after a while", async () => {
    const t = clock();
    const memory = new MemorySessionLocks(t.now);
    await (await memory.acquire("k"))?.release();
    t.advance(HELD_TTL_MS - 1);
    expect(await memory.lastHeld("k")).toBeDefined();
    t.advance(1);
    expect(await memory.lastHeld("k")).toBeUndefined();
  });
});

const redisUrl = process.env.REDIS_URL_TEST || process.env.REDIS_URL;

describe.skipIf(!redisUrl)("RedisSessionLocks against a real Redis", () => {
  const client = new Redis(redisUrl ?? "", { maxRetriesPerRequest: 1 });
  afterAll(() => client.quit());
  const time = clock();
  const prefix = `test-${process.pid}-${Date.now()}`;
  sharedContract({
    locks: new RedisSessionLocks(client, time.now),
    time,
    expire: (ms) => Bun.sleep(ms),
    key: (name) => `${prefix}:${name}`,
  });
});

describe("arrivedWhileHeld", () => {
  const held = { from: 10_000, to: 15_000 };

  test("a message dated inside the hold arrived while it was held", () => {
    expect(arrivedWhileHeld(10, held)).toBe(true);
    expect(arrivedWhileHeld(14, held)).toBe(true);
  });

  test("the second the hold ended in, and anything outside, is not counted", () => {
    expect(arrivedWhileHeld(9, held)).toBe(false);
    expect(arrivedWhileHeld(15, held)).toBe(false);
    expect(arrivedWhileHeld(12, undefined)).toBe(false);
    // A hold that began mid-second does not claim that second.
    expect(arrivedWhileHeld(10, { from: 10_400, to: 15_000 })).toBe(false);
  });
});
