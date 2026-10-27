import { describe, expect, test } from "bun:test";
import { parseOwnerWorkbook, parsePos } from "../../src/words/owner-list";
import { buildWorkbook, ownerWorkbook } from "./owner-workbook";

describe("owner word list parser", () => {
  const list = parseOwnerWorkbook(ownerWorkbook());

  test("reads the learning sheets in curriculum order and skips day headers", () => {
    expect(list.words.map((word) => [word.lemma, word.stage, word.index])).toEqual([
      ["apple", 0, 1],
      ["run", 0, 2],
      ["cat", 0, 3],
      ["decide", 1, 1],
      ["journey", 1, 2],
      ["borrow", 1, 3],
      ["advocate", 2, 1],
      ["zephyr", 4, 1],
    ]);
  });

  test("levels: per row on the A1–A2 sheet, per sheet elsewhere, C2 for the rare bands", () => {
    const level = (lemma: string) => list.words.find((word) => word.lemma === lemma)?.cefrLevel;
    expect([level("apple"), level("run"), level("decide"), level("advocate")]).toEqual([
      "A1",
      "A2",
      "B1",
      "B2",
    ]);
    expect(level("zephyr")).toBe("C2");
  });

  test("owner fields are read; empty cells become null; lemmas are lower-cased", () => {
    expect(list.words.find((word) => word.lemma === "run")).toEqual({
      lemma: "run",
      pos: ["verb", "noun"],
      ipa: "/rʌn/",
      translationRu: "бежать, бег",
      example: "I run every day.",
      topic: "Спорт",
      cefrLevel: "A2",
      stage: 0,
      index: 2,
    });
    expect(list.words.find((word) => word.lemma === "zephyr")).toMatchObject({
      pos: [],
      example: null,
    });
  });

  test("the removed list is read and its lemmas are not imported", () => {
    expect(list.removed).toEqual([{ lemma: "british", reason: "национальность" }]);
    const withRemoved = buildWorkbook({
      "0 Проверка A1–A2": [
        ["№", "Слово", "Уровень"],
        [1, "British", "A1"],
        [2, "tea", "A1"],
      ],
      ...Object.fromEntries(
        ["1 B1", "2 B2", "3 C1", "4 Редкие I", "5 Редкие II", "6 Редкие III"].map((name) => [
          name,
          [["№", "Слово"]],
        ]),
      ),
      Убрано: [["Слово"], ["british"]],
    });
    expect(parseOwnerWorkbook(withRemoved).words.map((word) => word.lemma)).toEqual(["tea"]);
  });

  test("parts of speech map to the dictionary's names", () => {
    expect(parsePos("прил., нареч., межд., сущ.")).toEqual([
      "adjective",
      "adverb",
      "interjection",
      "noun",
    ]);
    expect(parsePos("мод. гл.")).toEqual(["modal"]);
    expect(parsePos(undefined)).toEqual([]);
  });

  test("a workbook without a learning sheet is rejected", () => {
    expect(() => parseOwnerWorkbook(buildWorkbook({ Убрано: [["Слово"]] }))).toThrow(
      /no sheet "0 Проверка A1–A2"/,
    );
  });
});
