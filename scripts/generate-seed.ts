// Regenerates `seed/` from the owner's workbook (which stays outside git):
//   bun run seed:generate ../EnglishCoach-data/owner-words-v2.xlsx
// Refuses to write while an exercise item and its answer do not pair up.
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildOwnerSeed, ownerSeedFiles } from "../src/words/owner-seed";

const path = process.argv[2];
if (!path) {
  console.error("usage: bun run seed:generate <workbook.xlsx>");
  process.exit(1);
}

const { seed, mismatches } = buildOwnerSeed(new Uint8Array(await Bun.file(path).arrayBuffer()));
if (mismatches.length > 0) {
  console.error(`${mismatches.length} exercise items and answers do not pair up:`);
  for (const mismatch of mismatches) console.error(`  ${mismatch}`);
  process.exit(1);
}

const dir = join(import.meta.dir, "../seed");
// Generated wholesale: a topic or stage the workbook no longer has must not linger.
for (const generated of ["words", "grammar"])
  await rm(join(dir, generated), { recursive: true, force: true });
for (const [file, text] of Object.entries(ownerSeedFiles(seed))) {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await Bun.write(join(dir, file), text);
}
// The committed files are in Biome's format, so `bun run lint` passes on a fresh generation.
const format = Bun.spawnSync(["bunx", "biome", "format", "--write", dir], { stdout: "ignore" });
if (format.exitCode !== 0) {
  console.error(format.stderr.toString());
  process.exit(1);
}

console.log(
  `seed: ${seed.words.length} words, ${seed.removed.length} removed, ` +
    `${seed.grammar.length} grammar topics, ` +
    `${seed.grammar.reduce((sum, topic) => sum + topic.exercises.length, 0)} exercises, ` +
    `${seed.phrasalVerbs.length} phrasal verbs, ${seed.plan.length} plan days`,
);
