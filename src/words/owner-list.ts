import { z } from "zod";
import { type CefrLevel, cefrLevelEnum } from "../db/schema";
import { type SheetRow, Workbook } from "./xlsx";

/**
 * The owner's curated word list: an .xlsx workbook that lives outside the repository (it builds
 * on Oxford 5000 levels and dictionary examples we must not redistribute). Only its layout is
 * known here; tests use a synthetic workbook of the same shape.
 */

/** Learning sheets in curriculum order; the leading digit of the name is the stage. */
export const OWNER_SHEETS = [
  "0 Проверка A1–A2",
  "1 B1",
  "2 B2",
  "3 C1",
  "4 Редкие I",
  "5 Редкие II",
  "6 Редкие III",
] as const;
export const REMOVED_SHEET = "Убрано";

/** Stages 1–6 have one level each; stage 0 gives it per row. The rare bands count as C2. */
const STAGE_LEVEL: Record<number, CefrLevel | undefined> = {
  1: "B1",
  2: "B2",
  3: "C1",
  4: "C2",
  5: "C2",
  6: "C2",
};

/** First stage of the rare bands (`Редкие I–III`). */
export const RARE_STAGE = 4;

/** Russian part-of-speech abbreviations used in the list → the dictionary's English names. */
const POS: Record<string, string> = {
  "сущ.": "noun",
  "прил.": "adjective",
  "гл.": "verb",
  "нареч.": "adverb",
  "числ.": "number",
  "мест.": "pronoun",
  "предл.": "preposition",
  союз: "conjunction",
  "опред.": "determiner",
  "арт.": "determiner",
  "мод. гл.": "modal",
  "всп. гл.": "auxiliary verb",
  "межд.": "interjection",
  "част.": "particle",
};

const HEADERS = {
  index: "№",
  topic: "Тема",
  lemma: "Слово",
  pos: "Часть речи",
  ipa: "Транскрипция",
  translation: "Перевод",
  example: "Пример",
  level: "Уровень",
} as const;

/** The day-header rows of the dated sheets start with this. */
const DAY_HEADER = "📅";

const optional = z
  .string()
  .trim()
  .transform((value) => value || null)
  .nullable();

export const ownerWordSchema = z.object({
  lemma: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.toLowerCase()),
  pos: z.array(z.string().min(1)),
  ipa: optional,
  translationRu: optional,
  example: optional,
  topic: optional,
  cefrLevel: z.enum(cefrLevelEnum.enumValues),
  stage: z
    .number()
    .int()
    .min(0)
    .max(OWNER_SHEETS.length - 1),
  index: z.number().int().positive(),
});
export type OwnerWord = z.infer<typeof ownerWordSchema>;

export type ExcludedEntry = { lemma: string; reason: string | null };

export type OwnerList = { words: OwnerWord[]; removed: ExcludedEntry[] };

/** Maps "прил., сущ." to ["adjective", "noun"]; unknown abbreviations are kept as written. */
export function parsePos(text: string | undefined): string[] {
  const parts = (text ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(parts.map((part) => POS[part] ?? part))];
}

/** Column letter of each known header in row 1. */
function columnsOf(header: SheetRow): Partial<Record<keyof typeof HEADERS, string>> {
  const columns: Partial<Record<keyof typeof HEADERS, string>> = {};
  for (const [column, text] of Object.entries(header)) {
    for (const [key, title] of Object.entries(HEADERS)) {
      if (text === title) columns[key as keyof typeof HEADERS] = column;
    }
  }
  return columns;
}

function parseSheet(workbook: Workbook, sheet: string, stage: number): OwnerWord[] {
  const [header, ...rows] = workbook.rows(sheet);
  const columns = columnsOf(header?.cells ?? {});
  if (!columns.lemma) throw new Error(`sheet "${sheet}" has no "${HEADERS.lemma}" column`);
  const cell = (cells: SheetRow, key: keyof typeof HEADERS) => {
    const column = columns[key];
    return column ? cells[column] : undefined;
  };

  const words: OwnerWord[] = [];
  for (const { row, cells } of rows) {
    if (Object.values(cells).some((text) => text.startsWith(DAY_HEADER))) continue;
    const lemma = cell(cells, "lemma");
    if (!lemma) continue;
    const parsed = ownerWordSchema.safeParse({
      lemma,
      pos: parsePos(cell(cells, "pos")),
      ipa: cell(cells, "ipa") ?? null,
      translationRu: cell(cells, "translation") ?? null,
      example: cell(cells, "example") ?? null,
      topic: cell(cells, "topic") ?? null,
      cefrLevel: STAGE_LEVEL[stage] ?? cell(cells, "level"),
      stage,
      index: Number(cell(cells, "index") ?? words.length + 1),
    });
    if (!parsed.success) throw new Error(`invalid row ${row} on sheet "${sheet}": ${lemma}`);
    words.push(parsed.data);
  }
  return words;
}

/**
 * Reads the learning sheets (in curriculum order) and the removed list. A lemma listed twice keeps
 * its first, earliest position; a removed lemma is dropped from the words. The phrasal-verb and
 * grammar sheets are not read.
 */
export function parseOwnerWorkbook(bytes: Uint8Array): OwnerList {
  const workbook = new Workbook(bytes);
  const removed = new Map<string, ExcludedEntry>();
  for (const { cells } of workbook.rows(REMOVED_SHEET).slice(1)) {
    const lemma = cells.A?.trim().toLowerCase();
    if (lemma && !removed.has(lemma)) removed.set(lemma, { lemma, reason: cells.C ?? null });
  }

  const seen = new Set<string>();
  const words: OwnerWord[] = [];
  OWNER_SHEETS.forEach((sheet, stage) => {
    for (const word of parseSheet(workbook, sheet, stage)) {
      if (seen.has(word.lemma) || removed.has(word.lemma)) continue;
      seen.add(word.lemma);
      words.push(word);
    }
  });
  return { words, removed: [...removed.values()] };
}
