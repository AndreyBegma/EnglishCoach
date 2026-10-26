import type { StorageAdapter } from "grammy";
import type Redis from "ioredis";

/** Flow state is short-lived; an abandoned flow disappears after a week. */
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

/** grammY session storage in Redis, as JSON under `<prefix><session key>`. */
export function redisStorage<T>(
  client: Redis,
  { prefix = "flow:", ttlSeconds = DEFAULT_TTL_SECONDS } = {},
): StorageAdapter<T> {
  return {
    async read(key) {
      const value = await client.get(prefix + key);
      return value === null ? undefined : (JSON.parse(value) as T);
    },
    async write(key, value) {
      await client.set(prefix + key, JSON.stringify(value), "EX", ttlSeconds);
    },
    async delete(key) {
      await client.del(prefix + key);
    },
  };
}
