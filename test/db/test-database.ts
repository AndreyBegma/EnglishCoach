import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb, type Database } from "../../src/db/client";

// Needs a real Postgres: CI provides one; locally run `docker compose up -d postgres` and export
// DATABASE_URL (or DATABASE_URL_TEST). On a bare clone the DB tests are skipped, not failed.
// Each test file gets its own throwaway database on that server, so nothing touches real data.
// `||` rather than `??`: an empty DATABASE_URL_TEST= copied from .env.example means "unset".
export const testServerUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

const migrationsFolder = join(import.meta.dir, "../../drizzle");

/** Creates an empty database, applies every migration in `drizzle/`, and drops it on close. */
export async function createTestDatabase(serverUrl: string): Promise<Database> {
  const name = `coach_test_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${name}"`);

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const database = createDb(url.toString());
  try {
    await migrate(database.db, { migrationsFolder });
  } catch (error) {
    await database.close();
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end();
    throw error;
  }

  return {
    ...database,
    close: async () => {
      await database.close();
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
      await admin.end();
    },
  };
}

/** The Postgres SQLSTATE of a failed query, unwrapping drizzle's query error. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = current.cause;
  }
  return undefined;
}

export const UNIQUE_VIOLATION = "23505";
