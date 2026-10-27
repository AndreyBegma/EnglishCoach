import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { excelDate } from "../../src/words/owner-extras";
import { parseOwnerWorkbook } from "../../src/words/owner-list";
import { buildOwnerSeed, ownerSeedFiles, readOwnerSeed } from "../../src/words/owner-seed";
import { ANSWER_ROWS, ownerWorkbook } from "../words/owner-workbook";

describe("seed generator", () => {
  const { seed, mismatches } = buildOwnerSeed(ownerWorkbook());
  const files = ownerSeedFiles(seed);
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  const writeSeed = async (contents: Record<string, string>) => {
    const dir = await mkdtemp(join(tmpdir(), "owner-seed-"));
    dirs.push(dir);
    for (const [file, text] of Object.entries(contents)) {
      await mkdir(dirname(join(dir, file)), { recursive: true });
      await Bun.write(join(dir, file), text);
    }
    return dir;
  };

  test("no word-sheet example sentence appears in any generated file", () => {
    const examples = parseOwnerWorkbook(ownerWorkbook()).words.flatMap((word) =>
      word.example ? [word.example] : [],
    );
    expect(examples.length).toBeGreaterThan(0);
    for (const text of Object.values(files)) {
      for (const example of examples) expect(text).not.toContain(example);
    }
    expect(seed.words.every((word) => !("example" in word))).toBe(true);
  });

  test("words keep everything else, in curriculum order; day headers are not words", () => {
    expect(seed.words).toHaveLength(8);
    expect(seed.words[1]).toEqual({
      lemma: "run",
      pos: ["verb", "noun"],
      ipa: "/rʌn/",
      translationRu: "бежать, бег",
      topic: "Спорт",
      cefrLevel: "A2",
      stage: 0,
      index: 2,
    });
    expect(seed.removed).toEqual([{ lemma: "british", reason: "национальность" }]);
    expect(Object.keys(files).filter((file) => file.startsWith("words/"))).toHaveLength(7);
  });

  test("grammar topics carry stable ids, rule sections and items joined with answers", () => {
    expect(mismatches).toEqual([]);
    expect(seed.grammar.map((topic) => [topic.id, topic.cefrLevel, topic.title])).toEqual([
      ["g001", "A2", "Глагол to be"],
      ["g002", "B1", "Past Simple"],
    ]);
    const [first, second] = seed.grammar;
    expect([second?.plannedFrom, second?.plannedTo]).toEqual(["2026-10-20", "2026-10-21"]);
    expect(first?.sections.formation).toEqual(["• I am", "• he is"]);
    // A capitalised sub-heading inside a section stays part of it.
    expect(second?.sections.formation).toEqual(["V2.", "ВРЕМЕНА", "• did + V"]);
    expect(first?.exercises[1]).toEqual({
      number: 2,
      instruction: "Переведите на английский",
      items: [
        { number: 1, prompt: "Я разработчик.", answer: "I am a developer. / I'm a developer." },
        { number: 2, prompt: "Она дома.", answer: "She is at home." },
      ],
    });
    expect(files["grammar/g002.json"]).toBeDefined();
  });

  test("an item without an answer and an answer without an item are both reported", () => {
    const answers = [...ANSWER_ROWS.filter((row) => row[3] !== "is"), [3, 1, 1, "orphan"]];
    const result = buildOwnerSeed(ownerWorkbook({ answers }));
    expect(result.mismatches).toEqual([
      "no answer for topic 1, exercise 1, item 2",
      "answer for no item: topic 3, exercise 1, item 1",
    ]);
  });

  test("a rule line outside any section is an error, not silently dropped", () => {
    const rows = [["Тема 1 · A2 · T · 19.10.2026–19.10.2026"], [null, "stray line"]];
    expect(() => buildOwnerSeed(ownerWorkbook({ rows }))).toThrow(/outside a rule section/);
  });

  test("phrasal verbs keep the owner's examples; the plan keeps its days", () => {
    expect(seed.phrasalVerbs).toEqual([
      {
        number: 1,
        phrase: "give up",
        translationRu: "сдаваться",
        example: "Never give up on a good idea.",
        planDay: 1,
      },
      {
        number: 2,
        phrase: "back up",
        translationRu: "сделать копию",
        example: null,
        planDay: null,
      },
    ]);
    expect(seed.plan.map((day) => [day.day, day.date, day.wordCount, day.phrasalVerbs])).toEqual([
      [1, "2026-10-19", 3, "№ 1–2"],
      [2, "2026-10-20", 1, null],
    ]);
    expect(excelDate(46314)).toBe("2026-10-19");
  });

  test("the files read back to the same seed", async () => {
    expect(await readOwnerSeed(await writeSeed(files))).toEqual(seed);
  });

  test("a committed word with an example is rejected", async () => {
    const stage = JSON.parse(files["words/stage-0.json"] ?? "[]");
    stage[0].example = "An apple a day.";
    const dir = await writeSeed({ ...files, "words/stage-0.json": JSON.stringify(stage) });
    await expect(readOwnerSeed(dir)).rejects.toThrow(/stage-0\.json/);
  });
});
