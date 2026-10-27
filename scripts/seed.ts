// Loads everything the repository seeds, idempotently: the CEFR frequency dictionary
// (`data/words/`), then the owner's committed content (`seed/`) over it. Examples set by
// `db:import:owner-words` survive a reload. Ends with the dictionary pronunciation (IPA,
// syllables, stress), so a fresh deploy needs no separate `db:import:pronunciation`.
import { join } from "node:path";
import { createDb } from "../src/db/client";
import { loadOwnerSeed, readOwnerSeed } from "../src/words/owner-seed";
import { loadPronunciationSources } from "../src/words/pronunciation";
import { importPronunciation } from "../src/words/pronunciation-import";
import { parseWordsCsv, seedWords } from "../src/words/seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const dictionary = parseWordsCsv(
  await Bun.file(join(import.meta.dir, "../data/words/words.csv")).text(),
);
const seed = await readOwnerSeed(join(import.meta.dir, "../seed"));
const database = createDb(url);
try {
  console.log(`dictionary: ${await seedWords(database.db, dictionary)} words`);
  const result = await loadOwnerSeed(database.db, seed);
  console.log(
    `owner list: ${result.updated} updated, ${result.inserted} inserted, ` +
      `${result.dropped} dropped from the list, ${result.removed} removed lemmas`,
  );
  console.log(
    `grammar: ${result.topics} topics, ${result.exercises} exercises, ${result.items} items; ` +
      `${result.phrasalVerbs} phrasal verbs; ${result.planDays} plan days`,
  );
  const pronunciation = await importPronunciation(database.db, await loadPronunciationSources());
  console.log(
    `pronunciation: ${pronunciation.updated} of ${pronunciation.total} words updated; ` +
      `US IPA ${pronunciation.withUs}, UK IPA ${pronunciation.withUk}, ` +
      `syllables ${pronunciation.withSyllables}`,
  );
} finally {
  await database.close();
}
