import { strToU8, zipSync } from "fflate";

/**
 * Builds a synthetic workbook with the layout of the owner's list (same sheet names and columns),
 * so the importer is tested without the real, non-redistributable data.
 */

type Cell = string | number | null;

const esc = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function column(index: number): string {
  return String.fromCharCode(65 + index);
}

function sheetXml(rows: Cell[][]): string {
  const body = rows
    .map((cells, r) => {
      const xml = cells
        .map((value, c) => {
          const ref = `${column(c)}${r + 1}`;
          if (value === null) return `<c r="${ref}" t="inlineStr"></c>`;
          if (typeof value === "number") return `<c r="${ref}" t="n"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${xml}</row>`;
    })
    .join("");
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function buildWorkbook(sheets: Record<string, Cell[][]>): Uint8Array {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="worksheet" Target="/xl/worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("")}</Relationships>`,
    ),
  };
  names.forEach((name, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheets[name] ?? []));
  });
  return zipSync(files);
}

const BASIC_HEADER = [
  "№",
  "Тема",
  "Слово",
  "Часть речи",
  "Транскрипция",
  "Перевод",
  "Пример",
  "Уровень",
  "✓ знаю",
];
const DATED_HEADER = [
  "№",
  "Дата",
  "Неделя",
  "Тема",
  "Слово",
  "Часть речи",
  "Транскрипция",
  "Перевод",
  "Пример",
  "✓",
];

const dated = (index: number, lemma: string, pos: string | null, example: string | null) => [
  index,
  46314,
  1,
  "Тема",
  lemma,
  pos,
  `/${lemma}/`,
  `${lemma}-ru`,
  example,
  null,
];

/**
 * The fixture list. A1–A2: `apple` (A1), `run` (A2, two parts of speech), `cat` (A1). B1, in this
 * order: `decide`, `journey`, `borrow`. B2: `advocate`. Rare I: `zephyr` (no POS, no example).
 * `british` is listed as removed (it is also in the seed). Day-header rows and the sheets that
 * are not imported are there too.
 */
export function ownerWorkbook(): Uint8Array {
  return buildWorkbook({
    "Как учить": [["text"]],
    "0 Проверка A1–A2": [
      BASIC_HEADER,
      [1, "Еда", "apple", "сущ.", "/ˈæpl/", "яблоко", "An apple a day.", "A1", null],
      [2, "Спорт", "Run", "гл., сущ.", "/rʌn/", "бежать, бег", "I run every day.", "A2", null],
      [3, "Животные", "cat", "сущ.", "/kæt/", "кот", "The cat sleeps.", "A1", "✓"],
    ],
    "1 B1": [
      DATED_HEADER,
      ["📅 19.10.2026 (Пн) · неделя 1 · Тема · 3 слов"],
      dated(1, "decide", "гл.", "We decided to stay."),
      dated(2, "journey", "сущ.", "A long journey."),
      ["📅 20.10.2026 (Вт) · неделя 1 · Тема · 1 слов"],
      dated(3, "borrow", "гл.", null),
    ],
    "2 B2": [DATED_HEADER, dated(1, "advocate", "сущ., гл.", "She is an advocate.")],
    "3 C1": [DATED_HEADER],
    "4 Редкие I": [DATED_HEADER, dated(1, "zephyr", null, null)],
    "5 Редкие II": [DATED_HEADER],
    "6 Редкие III": [DATED_HEADER],
    "Фразовые глаголы": [["Глагол"], ["give up"]],
    Грамматика: [["Тема"]],
    Ответы: [["Ответ"]],
    Убрано: [
      ["Слово", "Перевод", "Почему убрано", "Был на листе"],
      ["british", "британский", "национальность", "1 База"],
    ],
  });
}
