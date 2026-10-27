// Imports the owner's curated word list into `words`. The workbook stays outside git:
//   bun run db:import:owner-words data/private/owner-words.xlsx
import { createDb } from "../src/db/client";
import { importOwnerList } from "../src/words/owner-import";
import { parseOwnerWorkbook } from "../src/words/owner-list";

const url = process.env.DATABASE_URL;
const path = process.argv[2];
if (!url || !path) {
  console.error(
    !url ? "DATABASE_URL is not set" : "usage: bun run db:import:owner-words <workbook.xlsx>",
  );
  process.exit(1);
}

const list = parseOwnerWorkbook(new Uint8Array(await Bun.file(path).arrayBuffer()));
const database = createDb(url);
try {
  const result = await importOwnerList(database.db, list);
  console.log(
    `owner list: ${result.updated} updated, ${result.inserted} inserted, ` +
      `${result.dropped} dropped from the list, ${result.removed} removed lemmas`,
  );
} finally {
  await database.close();
}
