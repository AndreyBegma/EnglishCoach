// Applies every pending migration in `drizzle/` to DATABASE_URL. Run by scripts/entrypoint.sh on
// each boot: drizzle records applied migrations, so a second run is a no-op. It uses the runtime
// migrator (drizzle-orm) because the image carries production dependencies only, not drizzle-kit.
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db/client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const database = createDb(url);
try {
  await migrate(database.db, { migrationsFolder: join(import.meta.dir, "../drizzle") });
  console.log("migrations: up to date");
} finally {
  await database.close();
}
