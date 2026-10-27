import { z } from "zod";
import type { SheetRow, Workbook } from "./xlsx";

/**
 * The owner's phrasal verbs (sheet `Фразовые глаголы`, the owner's own examples) and daily plan
 * (sheet `План`). Both are committed as seed data; see `src/words/owner-seed.ts`.
 */

export const PHRASAL_VERBS_SHEET = "Фразовые глаголы";
export const PLAN_SHEET = "План";

const text = z.string().min(1);
const optional = text.nullable();

export const phrasalVerbSchema = z.strictObject({
  number: z.number().int().positive(),
  phrase: text,
  translationRu: text,
  example: optional,
  planDay: z.number().int().positive().nullable(),
});
export type PhrasalVerbSeed = z.infer<typeof phrasalVerbSchema>;

export const planDaySchema = z.strictObject({
  day: z.number().int().positive(),
  date: z.iso.date(),
  week: z.number().int().positive(),
  stage: text,
  wordTopic: optional,
  wordCount: z.number().int().nonnegative().nullable(),
  reviewWords: optional,
  phrasalVerbs: optional,
  grammar: optional,
});
export type PlanDaySeed = z.infer<typeof planDaySchema>;

/** Column letter of each header title found in a sheet's first row. */
function headerColumns<K extends string>(
  sheet: string,
  header: SheetRow | undefined,
  titles: Record<K, string>,
): Record<K, string> {
  const columns: Partial<Record<K, string>> = {};
  for (const [key, title] of Object.entries(titles) as [K, string][]) {
    const column = Object.entries(header ?? {}).find(([, value]) => value === title)?.[0];
    if (!column) throw new Error(`sheet "${sheet}" has no "${title}" column`);
    columns[key] = column;
  }
  return columns as Record<K, string>;
}

const numberOrNull = (value: string | undefined) => (value ? Number(value) : null);

export function parsePhrasalVerbs(workbook: Workbook): PhrasalVerbSeed[] {
  const [header, ...rows] = workbook.rows(PHRASAL_VERBS_SHEET);
  const col = headerColumns(PHRASAL_VERBS_SHEET, header?.cells, {
    number: "№",
    phrase: "Фразовый глагол",
    translationRu: "Перевод",
    example: "Пример",
    planDay: "День плана",
  });
  return rows.flatMap(({ row, cells }) => {
    if (!cells[col.phrase]) return [];
    const parsed = phrasalVerbSchema.safeParse({
      number: Number(cells[col.number]),
      phrase: cells[col.phrase],
      translationRu: cells[col.translationRu],
      example: cells[col.example] ?? null,
      planDay: numberOrNull(cells[col.planDay]),
    });
    if (!parsed.success) throw new Error(`invalid row ${row} on sheet "${PHRASAL_VERBS_SHEET}"`);
    return [parsed.data];
  });
}

/** An Excel date serial (days since 1899-12-30) → "YYYY-MM-DD". */
export function excelDate(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
}

/** The plan's days in order; the owner's progress columns (`Выучено`, `%`) are not read. */
export function parsePlan(workbook: Workbook): PlanDaySeed[] {
  const [header, ...rows] = workbook.rows(PLAN_SHEET);
  const col = headerColumns(PLAN_SHEET, header?.cells, {
    date: "Дата",
    week: "Неделя",
    stage: "Этап",
    wordTopic: "Слова: тема",
    wordCount: "Слов",
    reviewWords: "Повторить слова за",
    phrasalVerbs: "Фразовые глаголы",
    grammar: "Грамматика сегодня (20 мин)",
  });
  const days: PlanDaySeed[] = [];
  for (const { row, cells } of rows) {
    if (!cells[col.date]) continue;
    const parsed = planDaySchema.safeParse({
      day: days.length + 1,
      date: excelDate(Number(cells[col.date])),
      week: Number(cells[col.week]),
      stage: cells[col.stage],
      wordTopic: cells[col.wordTopic] ?? null,
      wordCount: numberOrNull(cells[col.wordCount]),
      reviewWords: cells[col.reviewWords] ?? null,
      phrasalVerbs: cells[col.phrasalVerbs] ?? null,
      grammar: cells[col.grammar] ?? null,
    });
    if (!parsed.success) throw new Error(`invalid row ${row} on sheet "${PLAN_SHEET}"`);
    days.push(parsed.data);
  }
  return days;
}
