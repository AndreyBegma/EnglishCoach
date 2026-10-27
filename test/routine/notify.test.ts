import { afterAll, describe, expect, test } from "bun:test";
import Redis from "ioredis";
import { MemoryRoutineStore, RedisRoutineStore } from "../../src/routine";
import { MAX_NOTIFICATIONS_PER_DAY, reserveNotification } from "../../src/routine/notify";
import { isQuietMinute, localMinutes, minutesOf, reminderMinute } from "../../src/routine/time";

const at = (iso: string) => new Date(iso);

describe("quiet hours", () => {
  test("22:00 to 08:00, wrapping midnight", () => {
    expect(isQuietMinute(minutesOf("21:59"))).toBe(false);
    expect(isQuietMinute(minutesOf("22:00"))).toBe(true);
    expect(isQuietMinute(minutesOf("03:00"))).toBe(true);
    expect(isQuietMinute(minutesOf("07:59"))).toBe(true);
    expect(isQuietMinute(minutesOf("08:00"))).toBe(false);
    expect(isQuietMinute(minutesOf("23:00") + 120)).toBe(true); // 01:00 the next day
  });

  test("local minutes follow the zone's DST", () => {
    // 19:30Z is 21:30 in Kyiv in winter (EET) and 22:30 in summer (EEST).
    expect(localMinutes(at("2026-01-15T19:30:00Z"), "Europe/Kyiv")).toBe(minutesOf("21:30"));
    expect(localMinutes(at("2026-07-15T19:30:00Z"), "Europe/Kyiv")).toBe(minutesOf("22:30"));
  });
});

describe("reminderMinute", () => {
  test("evening + 2 h when that is before quiet hours", () => {
    expect(reminderMinute(minutesOf("18:00"))).toBe(minutesOf("20:00"));
  });

  test("pulled back to 21:30 when evening + 2 h is quiet", () => {
    expect(reminderMinute(minutesOf("20:00"))).toBe(minutesOf("21:30"));
    expect(reminderMinute(minutesOf("21:00"))).toBe(minutesOf("21:30"));
  });

  test("left late (and dropped at fire time) when 21:30 is too close to the evening", () => {
    expect(reminderMinute(minutesOf("21:30"))).toBe(minutesOf("23:30"));
    expect(reminderMinute(minutesOf("23:00"))).toBe(minutesOf("23:00") + 120);
  });
});

describe("reserveNotification", () => {
  const request = (slot: "morning" | "evening" | "reminder", iso: string) => ({
    userId: 1,
    slot,
    now: at(iso),
    timezone: "Europe/Kyiv",
  });

  test("the reminder is dropped in quiet hours; the plans are not", async () => {
    const store = new MemoryRoutineStore();
    // 20:30Z on 15 Jan is 22:30 in Kyiv.
    expect(await reserveNotification(store, request("reminder", "2026-01-15T20:30:00Z"))).toBe(
      undefined,
    );
    expect(
      await reserveNotification(store, request("evening", "2026-01-15T20:30:00Z")),
    ).toBeFunction();
    expect(
      await reserveNotification(store, request("reminder", "2026-01-15T19:30:00Z")),
    ).toBeFunction();
  });

  test("at most three a learner-local day; a release gives one back; the next day starts over", async () => {
    const store = new MemoryRoutineStore();
    const noon = request("morning", "2026-01-15T10:00:00Z");
    const releases = [];
    for (let i = 0; i < MAX_NOTIFICATIONS_PER_DAY; i++) {
      releases.push(await reserveNotification(store, noon));
    }
    expect(releases.every(Boolean)).toBe(true);
    expect(await reserveNotification(store, noon)).toBeUndefined();
    await releases[0]?.();
    expect(await reserveNotification(store, noon)).toBeFunction();
    // 22:30Z on the 15th is already the 16th in Kyiv.
    expect(
      await reserveNotification(store, request("morning", "2026-01-15T22:30:00Z")),
    ).toBeFunction();
  });
});

// Needs a real Redis: locally `docker compose up -d redis` and export REDIS_URL.
const redisUrl = process.env.REDIS_URL;

describe.skipIf(!redisUrl)("the daily cap in Redis", () => {
  const client = new Redis(redisUrl ?? "", { maxRetriesPerRequest: 1 });
  afterAll(() => client.quit());

  test("counts atomically up to the cap and releases", async () => {
    const store = new RedisRoutineStore(client);
    const userId = 990_000 + Math.floor(Math.random() * 9_999);
    const date = "2026-01-15";
    const tries = await Promise.all(
      Array.from({ length: 5 }, () => store.reserveNotification(userId, date, 3)),
    );
    expect(tries.filter(Boolean)).toHaveLength(3);
    await store.releaseNotification(userId, date);
    expect(await store.reserveNotification(userId, date, 3)).toBe(true);
    expect(await store.reserveNotification(userId, date, 3)).toBe(false);
    expect(await client.ttl(`routine:notified:${userId}:${date}`)).toBeGreaterThan(0);
    await client.del(`routine:notified:${userId}:${date}`);
  });
});
