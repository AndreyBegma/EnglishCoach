import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  checkLexicalData,
  type LexicalData,
  lexicalUnitRows,
  OWNER_PHRASAL_SOURCE,
  phrasalCore,
  readLexicalData,
} from "../../src/words/lexical";
import { readOwnerSeed } from "../../src/words/owner-seed";
import { parseWordsCsv } from "../../src/words/seed";

const root = join(import.meta.dir, "../..");

describe("data/lexical (the committed lists)", async () => {
  const data = await readLexicalData(join(root, "data/lexical"));
  const dictionary = new Set(
    parseWordsCsv(await Bun.file(join(root, "data/words/words.csv")).text()).map(
      (row) => row.lemma,
    ),
  );
  const owner = (await readOwnerSeed(join(root, "seed"))).phrasalVerbs;

  test("passes the second check", () => {
    expect(checkLexicalData(data, dictionary, owner)).toEqual([]);
  });

  test("covers the owner's phrasal verbs and tops them up to about 300", () => {
    const rows = lexicalUnitRows(data, owner).filter((row) => row.unitType === "phrasal_verb");
    expect(rows.filter((row) => row.source === OWNER_PHRASAL_SOURCE)).toHaveLength(owner.length);
    expect(rows.length).toBeGreaterThanOrEqual(280);
  });

  test("has every unit type, idioms only from B2", () => {
    expect(data.collocations.length).toBeGreaterThan(100);
    expect(data.wordFamilies.length).toBeGreaterThan(50);
    expect(new Set(data.idioms.map((idiom) => idiom.level))).toEqual(new Set(["B2", "C1", "C2"]));
  });
});

describe("checkLexicalData", () => {
  const dictionary = new Set(["give", "make", "decide", "decision"]);
  const empty: LexicalData = { phrasalVerbs: [], collocations: [], idioms: [], wordFamilies: [] };

  test("names each kind of problem", () => {
    const problems = checkLexicalData(
      {
        phrasalVerbs: [
          { phrase: "give up", verb: "give", particle: "in", level: "A2" },
          { phrase: "zork out", verb: "zork", particle: "out", level: "B1" },
          { phrase: "zork out", verb: "zork", particle: "out", level: "B1" },
        ],
        collocations: [{ phrase: "make a decision", partner: "do", level: "A2" }],
        idioms: [{ phrase: "break the ice", level: "B1" }],
        wordFamilies: [
          {
            lemma: "decide",
            level: "B1",
            forms: [
              ["noun", "decision"],
              ["noun", "decision"],
            ],
          },
        ],
      },
      dictionary,
      [{ number: 1, phrase: "back up", translationRu: "x", example: null, planDay: null }],
    );
    expect(problems).toEqual([
      'phrasal verb "give up" is not "give in"',
      'phrasal verb "zork out": verb not in dictionary',
      'phrasal verb "zork out": verb not in dictionary',
      'phrasal verb: "zork out" is listed twice',
      'owner phrasal verb "back up" has no level',
      'collocation "make a decision" does not contain "do"',
      'collocation "make a decision": "do" not in dictionary',
      'idiom "break the ice" is below B2',
      'word family "decide" does not list its lemma',
      'word family "decide" lists a form twice',
    ]);
  });

  test("caps the units of one type per level", () => {
    const idioms = Array.from({ length: 51 }, (_, i) => ({ phrase: `idiom ${i}`, level: "C1" }));
    expect(checkLexicalData({ ...empty, idioms } as LexicalData, dictionary, [])).toEqual([
      "idiom C1: 51 units, cap 50",
    ]);
  });

  test("the owner's variants reduce to the phrase a learner types", () => {
    expect(phrasalCore("fill in / fill out")).toBe("fill in");
    expect(phrasalCore("catch up (with)")).toBe("catch up");
    expect(phrasalCore("give up")).toBe("give up");
  });
});
