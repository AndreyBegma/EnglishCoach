import { describe, expect, test } from "bun:test";
import type { SizeTestCandidate } from "../../src/db/repositories/sizetest";
import type { SizeTestAnswer } from "../../src/db/schema";
import { BANDS, OPTIONS } from "../../src/sizetest/estimate";
import { buildItems, PER_BAND, PSEUDO_ITEMS, tally } from "../../src/sizetest/items";
import { PSEUDO_WORDS } from "../../src/sizetest/pseudowords";

/** A pinned "random" pick: always the first choice, so shuffles are deterministic. */
const first = () => 0;

const bandWords = (band: number, count = PER_BAND): SizeTestCandidate[] =>
  Array.from({ length: count }, (_, i) => ({
    wordId: band * 100 + i,
    lemma: `word${band}_${i}`,
    meaning: `meaning ${band}.${i}`,
  }));

const allBands = () => Array.from({ length: BANDS }, (_, i) => bandWords(i + 1));

describe("buildItems", () => {
  test("asks every band and mixes in pseudo-words, each with distinct options", () => {
    const items = buildItems(allBands(), first);
    expect(items).toHaveLength(BANDS * PER_BAND + PSEUDO_ITEMS);
    for (let band = 1; band <= BANDS; band++) {
      expect(items.filter((item) => item.band === band)).toHaveLength(PER_BAND);
    }
    for (const item of items) {
      expect(item.options).toHaveLength(OPTIONS);
      expect(new Set(item.options).size).toBe(OPTIONS);
      if (item.band === null) {
        expect(item.answer).toBeNull();
        expect(PSEUDO_WORDS).toContain(item.word);
      } else {
        const answer = item.answer ?? -1;
        expect(item.options[answer]).toBe(`meaning ${item.band}.${item.word.split("_")[1]}`);
      }
    }
  });

  test("the right meaning lands in different positions with a real shuffle", () => {
    let seed = 42;
    const pick = (below: number) => {
      seed = (seed * 16807) % 2147483647;
      return seed % below;
    };
    const positions = new Set(buildItems(allBands(), pick).map((item) => item.answer));
    expect(positions.size).toBeGreaterThan(2);
  });

  test("a lemma with two rows is asked once", () => {
    const byBand = allBands();
    const duplicate = { ...(byBand[0]?.[0] as SizeTestCandidate), wordId: 999 };
    byBand[1] = [duplicate, ...bandWords(2)];
    const items = buildItems(byBand, first);
    expect(items.filter((item) => item.word === duplicate.lemma)).toHaveLength(1);
  });

  test("long meanings are cut on their buttons", () => {
    const byBand = allBands();
    byBand[0] = [{ wordId: 1, lemma: "long", meaning: "x".repeat(80) }, ...bandWords(1, 3)];
    const item = buildItems(byBand, first).find((entry) => entry.word === "long");
    expect(item?.options[item.answer ?? -1]?.length).toBe(40);
  });

  test("too few meanings to fill the options builds nothing", () => {
    expect(buildItems([bandWords(1, 2)], first)).toEqual([]);
  });
});

describe("tally", () => {
  test("counts right answers per band and claimed pseudo-words", () => {
    const items = buildItems(allBands(), first);
    const answers: SizeTestAnswer[] = items.map((item) =>
      item.band === null ? 0 : item.band <= 2 ? item.answer : null,
    );
    const result = tally(items, answers);
    expect(result.pseudo).toEqual({ asked: PSEUDO_ITEMS, claimed: PSEUDO_ITEMS });
    expect(result.bands.find((band) => band.band === 1)).toEqual({
      band: 1,
      asked: PER_BAND,
      correct: PER_BAND,
    });
    expect(result.bands.find((band) => band.band === 3)?.correct).toBe(0);
  });

  test("items not answered yet are not counted", () => {
    const items = buildItems(allBands(), first);
    const result = tally(items, [null, null]);
    const asked = result.bands.reduce((sum, band) => sum + band.asked, 0) + result.pseudo.asked;
    expect(asked).toBe(2);
  });
});

describe("pseudo-words", () => {
  test("none is a word of the dictionary", async () => {
    const csv = await Bun.file(new URL("../../data/words/words.csv", import.meta.url)).text();
    const lemmas = new Set(csv.split("\n").map((line) => line.split(",")[0]?.toLowerCase()));
    expect(PSEUDO_WORDS.filter((word) => lemmas.has(word))).toEqual([]);
    expect(PSEUDO_WORDS.length).toBeGreaterThanOrEqual(PSEUDO_ITEMS * 3);
    expect(new Set(PSEUDO_WORDS).size).toBe(PSEUDO_WORDS.length);
  });
});
