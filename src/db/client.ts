import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return {
    db,
    /** Resolves when the database answers a trivial query. */
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => client.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDb>;
export type Db = Database["db"];
