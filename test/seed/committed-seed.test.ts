import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseOwnerWorkbook } from "../../src/words/owner-list";
import { readOwnerSeed } from "../../src/words/owner-seed";

const SEED_DIR = join(import.meta.dir, "../../seed");

// The owner's workbook is private; set OWNER_WORKBOOK to its path to also scan the committed seed
// for its word-sheet examples (Oxford dictionary sentences that must never be committed).
const workbookPath = process.env.OWNER_WORKBOOK || undefined;

async function seedTexts(): Promise<{ file: string; text: string }[]> {
  const files = await readdir(SEED_DIR, { recursive: true });
  return Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => ({ file, text: await Bun.file(join(SEED_DIR, file)).text() })),
  );
}

describe("the committed seed", async () => {
  // Strict schemas: a word carrying an `example` field fails to read.
  const seed = await readOwnerSeed(SEED_DIR);

  test("has the workbook's counts (day-header rows excluded)", () => {
    const exercises = seed.grammar.flatMap((topic) => topic.exercises);
    expect({
      words: seed.words.length,
      removed: seed.removed.length,
      topics: seed.grammar.length,
      exercises: exercises.length,
      items: exercises.reduce((sum, exercise) => sum + exercise.items.length, 0),
      phrasalVerbs: seed.phrasalVerbs.length,
      planDays: seed.plan.length,
    }).toEqual({
      words: 13_508,
      removed: 360,
      topics: 85,
      exercises: 425,
      items: 3_400,
      phrasalVerbs: 137,
      planDays: 537,
    });
  });

  test("grammar topics are numbered 1…n with stable ids, every item answered", () => {
    expect(seed.grammar.map((topic) => topic.position)).toEqual(
      seed.grammar.map((_, index) => index + 1),
    );
    for (const topic of seed.grammar) {
      expect(topic.id).toBe(`g${String(topic.position).padStart(3, "0")}`);
      for (const exercise of topic.exercises) {
        expect(exercise.items.length).toBeGreaterThan(0);
        for (const item of exercise.items) expect(item.answer.trim()).not.toBe("");
      }
    }
  });

  test("no file mentions an example field for a word", async () => {
    for (const { file, text } of await seedTexts()) {
      if (file.startsWith("words") || file === "removed.json") {
        expect(text).not.toMatch(/"example"\s*:/);
      }
    }
  });

  test.skipIf(!workbookPath)("contains no word-sheet example of the owner's workbook", async () => {
    const examples = parseOwnerWorkbook(
      new Uint8Array(await Bun.file(workbookPath ?? "").arrayBuffer()),
    ).words.flatMap((word) => (word.example ? [word.example] : []));
    expect(examples.length).toBeGreaterThan(0);
    const leaks: string[] = [];
    for (const { file, text } of await seedTexts()) {
      const wordFile = file.startsWith("words") || file === "removed.json";
      const values = new Set<string>();
      JSON.parse(text, (_, value) => {
        if (typeof value === "string") values.add(value);
        return value;
      });
      for (const example of examples) {
        // The owner's own grammar text shares stock phrases with the dictionary ("a piece of
        // cake", "Where do you live?"), so outside the word files a short example counts only
        // as a whole field; a copied sentence of five or more words counts anywhere.
        const copied =
          (wordFile || example.split(/\s+/).length >= 5) &&
          [...values].some((value) => value.includes(example));
        if (copied || values.has(example)) leaks.push(`${file}: ${example}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
