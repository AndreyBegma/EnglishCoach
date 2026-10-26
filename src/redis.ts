import Redis from "ioredis";

export function createRedis(url: string) {
  const client = new Redis(url, {
    lazyConnect: true,
    // Fail commands fast while disconnected instead of queueing them; health checks rely on it.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  return {
    client,
    /** Connects on first use; resolves when Redis answers PING. */
    ping: async () => {
      if (client.status === "wait") await client.connect();
      const reply = await client.ping();
      if (reply !== "PONG") throw new Error(`unexpected PING reply: ${reply}`);
    },
    close: async () => {
      await client.quit().catch(() => client.disconnect());
    },
  };
}

export type RedisHandle = ReturnType<typeof createRedis>;
