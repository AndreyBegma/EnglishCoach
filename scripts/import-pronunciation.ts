// Fills the dictionary IPA (US, UK), syllables and stress of every word, idempotently. Run after
// `db:seed` and after `db:import:owner-words`:
//   bun run db:import:pronunciation
import { createDb } from "../src/db/client";
import { loadPronunciationSources } from "../src/words/pronunciation";
import { importPronunciation } from "../src/words/pronunciation-import";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sources = await loadPronunciationSources();
const database = createDb(url);
try {
  const result = await importPronunciation(database.db, sources);
  const percent = (n: number) =>
    result.total ? `${((100 * n) / result.total).toFixed(1)}%` : "0%";
  console.log(
    `pronunciation: ${result.updated} of ${result.total} words updated; ` +
      `US IPA ${percent(result.withUs)}, UK IPA ${percent(result.withUk)}, ` +
      `syllables ${percent(result.withSyllables)}`,
  );
} finally {
  await database.close();
}
