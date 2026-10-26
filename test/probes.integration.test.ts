import { afterAll, describe, expect, test } from "bun:test";
import { createDb } from "../src/db/client";
import { createRedis } from "../src/redis";

// Needs real services: CI provides them; locally run `docker compose up -d postgres redis`
// and export DATABASE_URL / REDIS_URL. On a bare clone these are skipped, not failed.
const { DATABASE_URL, REDIS_URL } = process.env;

describe.skipIf(!DATABASE_URL)("postgres probe", () => {
  const database = createDb(DATABASE_URL ?? "");
  afterAll(() => database.close());

  test("answers select 1", async () => {
    await expect(database.ping()).resolves.toBeUndefined();
  });
});

describe.skipIf(!REDIS_URL)("redis probe", () => {
  const redis = createRedis(REDIS_URL ?? "");
  afterAll(() => redis.close());

  test("answers PING", async () => {
    await expect(redis.ping()).resolves.toBeUndefined();
  });
});
