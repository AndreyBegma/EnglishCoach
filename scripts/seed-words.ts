import { join } from "node:path";
import { createDb } from "../src/db/client";
import { parseWordsCsv, seedWords } from "../src/words/seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const rows = parseWordsCsv(await Bun.file(join(import.meta.dir, "../data/words/words.csv")).text());
const database = createDb(url);
try {
  console.log(`seeded ${await seedWords(database.db, rows)} words`);
} finally {
  await database.close();
}
