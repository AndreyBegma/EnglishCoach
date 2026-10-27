// Imports human-written example sentences from Tatoeba (CC BY 2.0 FR) for the dictionary's words,
// idempotently. Run after `db:seed` and `db:import:owner-words`:
//   bun run db:import:tatoeba [dir]
// The per-language exports are read from `dir` (default: $TATOEBA_DIR, else a tatoeba folder in
// the system temp directory). A file that is missing there is downloaded from
// downloads.tatoeba.org and decompressed with `bzip2`, which must be installed. The export is
// never committed.
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../src/db/client";
import { TATOEBA_FILES } from "../src/words/tatoeba";
import { importTatoeba, tatoebaSourcesFrom } from "../src/words/tatoeba-import";

const EXPORTS = "https://downloads.tatoeba.org/exports/per_language";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const dir = process.argv[2] ?? process.env.TATOEBA_DIR ?? join(tmpdir(), "tatoeba");
mkdirSync(dir, { recursive: true });

/** `eng-rus_links.tsv` lives under `eng/`, `rus_sentences_detailed.tsv` under `rus/`. */
const exportPath = (name: string) => `${name.slice(0, 3)}/${name}.bz2`;

async function download(name: string) {
  const target = join(dir, name);
  if (existsSync(target)) return;
  console.log(`downloading ${name}`);
  const response = await fetch(`${EXPORTS}/${exportPath(name)}`);
  if (!response.ok || !response.body) {
    throw new Error(`download of ${name} failed: HTTP ${response.status}`);
  }
  const bzip2 = Bun.spawn(["bzip2", "-dc"], {
    stdin: response.body,
    stdout: Bun.file(`${target}.part`),
  });
  if ((await bzip2.exited) !== 0) throw new Error(`bzip2 could not decompress ${name}`);
  renameSync(`${target}.part`, target);
}

for (const name of [
  TATOEBA_FILES.english,
  ...Object.values(TATOEBA_FILES.sentences),
  ...Object.values(TATOEBA_FILES.links),
]) {
  await download(name);
}

const database = createDb(url);
try {
  const result = await importTatoeba(database.db, tatoebaSourcesFrom(dir));
  console.log(
    `tatoeba: ${result.sentences} sentences (${result.inserted} new, ${result.removed} removed) ` +
      `for ${result.words} words, ${result.links} links; ` +
      `${result.passed} of ${result.scanned} translated sentences passed the filters`,
  );
} finally {
  await database.close();
}
