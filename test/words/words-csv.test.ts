import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseWordsCsv } from "../../src/words/seed";

const csvPath = join(import.meta.dir, "../../data/words/words.csv");

describe("parseWordsCsv", () => {
  test("parses rows and an empty rank as null", () => {
    expect(
      parseWordsCsv("lemma,pos,cefr_level,frequency_rank\nthe,determiner,A1,1\nzzz,noun,C2,\n"),
    ).toEqual([
      { lemma: "the", pos: "determiner", cefrLevel: "A1", frequencyRank: 1 },
      { lemma: "zzz", pos: "noun", cefrLevel: "C2", frequencyRank: null },
    ]);
  });

  test("rejects a wrong header, an unknown level and extra columns", () => {
    expect(() => parseWordsCsv("a,b\n")).toThrow("header");
    const header = "lemma,pos,cefr_level,frequency_rank\n";
    expect(() => parseWordsCsv(`${header}the,determiner,Z9,1\n`)).toThrow("row 2");
    expect(() => parseWordsCsv(`${header}the,determiner,A1,1,x\n`)).toThrow("row 2");
    expect(() => parseWordsCsv(`${header}the,determiner,A1,0\n`)).toThrow("row 2");
  });
});

describe("data/words/words.csv", () => {
  test("is valid, unique on (lemma, pos) and spans A1–C1 with at least 4,000 lemmas", async () => {
    const rows = parseWordsCsv(await Bun.file(csvPath).text());

    expect(new Set(rows.map((row) => row.lemma)).size).toBeGreaterThanOrEqual(4000);
    expect(new Set(rows.map((row) => `${row.lemma}|${row.pos}`)).size).toBe(rows.length);
    const levels = new Set(rows.map((row) => row.cefrLevel));
    for (const level of ["A1", "A2", "B1", "B2", "C1"] as const)
      expect(levels.has(level)).toBe(true);
  });
});
