import { z } from "zod";
import { cefrLevelEnum } from "../db/schema";
import type { Workbook } from "../words/xlsx";

/**
 * The owner's grammar course (sheets `Грамматика` and `Ответы` of the owner's workbook): topics
 * with Russian rule sections and exercises whose items are joined with the owner's answers.
 */

export const GRAMMAR_SHEET = "Грамматика";
export const ANSWERS_SHEET = "Ответы";

/** Section headings of a topic's rule, in sheet order → their seed keys. */
export const RULE_SECTIONS = {
  "ЗАЧЕМ ЭТО НУЖНО": "why",
  "КАК ОБРАЗУЕТСЯ": "formation",
  "КОГДА ИСПОЛЬЗУЕМ": "usage",
  "СЛОВА-ПОДСКАЗКИ": "signalWords",
  "ЧАСТЫЕ ОШИБКИ": "mistakes",
  ЗАПОМНИ: "remember",
} as const;
export type RuleSection = (typeof RULE_SECTIONS)[keyof typeof RULE_SECTIONS];

const RULE_MARKER = "📖 ПРАВИЛО";
const TOPIC_HEADER = /^Тема (\d+) · ([A-C][12]) · (.+) · (\d\d\.\d\d\.\d{4})–(\d\d\.\d\d\.\d{4})$/;
const EXERCISE_HEADER = /^✏️ Упражнение (\d+)\. (.+)$/;

const line = z.string().min(1);

export const grammarItemSchema = z.strictObject({
  number: z.number().int().positive(),
  prompt: line,
  answer: line,
});

export const grammarExerciseSchema = z.strictObject({
  number: z.number().int().positive(),
  instruction: line,
  items: z.array(grammarItemSchema),
});

const sectionsShape = Object.fromEntries(
  Object.values(RULE_SECTIONS).map((key) => [key, z.array(line).min(1)]),
) as Record<RuleSection, z.ZodArray<typeof line>>;

export const grammarTopicSchema = z.strictObject({
  /** Stable id: `g` + the owner's topic number, three digits. */
  id: z.string().regex(/^g\d{3}$/),
  position: z.number().int().positive(),
  cefrLevel: z.enum(cefrLevelEnum.enumValues),
  title: line,
  plannedFrom: z.iso.date().nullable(),
  plannedTo: z.iso.date().nullable(),
  sections: z.strictObject(sectionsShape),
  exercises: z.array(grammarExerciseSchema).min(1),
});
export type GrammarTopicSeed = z.infer<typeof grammarTopicSchema>;

export const topicId = (position: number) => `g${String(position).padStart(3, "0")}`;

/** "19.10.2026" → "2026-10-19". */
const isoDate = (text: string) => text.split(".").reverse().join("-");

type ParsedItem = { number: number; prompt: string };
type ParsedExercise = { number: number; instruction: string; items: ParsedItem[] };
type ParsedTopic = Omit<GrammarTopicSeed, "sections" | "exercises"> & {
  sections: Partial<Record<RuleSection, string[]>>;
  exercises: ParsedExercise[];
};

function parseTopics(workbook: Workbook): ParsedTopic[] {
  const topics: ParsedTopic[] = [];
  let topic: ParsedTopic | undefined;
  let section: RuleSection | undefined;
  let exercise: ParsedExercise | undefined;

  for (const { row, cells } of workbook.rows(GRAMMAR_SHEET)) {
    const { A: a, B: b } = cells;
    const at = `row ${row} of "${GRAMMAR_SHEET}"`;
    if (a && !b) {
      const header = a.match(TOPIC_HEADER);
      if (!header) throw new Error(`${at}: not a topic header: ${a}`);
      const [, position = "", level, title = "", from = "", to = ""] = header;
      topic = {
        id: topicId(Number(position)),
        position: Number(position),
        cefrLevel: level as GrammarTopicSeed["cefrLevel"],
        title,
        plannedFrom: isoDate(from),
        plannedTo: isoDate(to),
        sections: {},
        exercises: [],
      };
      topics.push(topic);
      section = undefined;
      exercise = undefined;
      continue;
    }
    if (!b) continue;
    if (!topic) throw new Error(`${at}: text before the first topic`);
    if (a) {
      if (!exercise || !/^\d+$/.test(a)) throw new Error(`${at}: item outside an exercise`);
      exercise.items.push({ number: Number(a), prompt: b });
      continue;
    }
    const exerciseHeader = b.match(EXERCISE_HEADER);
    if (exerciseHeader) {
      exercise = {
        number: Number(exerciseHeader[1]),
        instruction: exerciseHeader[2] ?? "",
        items: [],
      };
      topic.exercises.push(exercise);
      section = undefined;
      continue;
    }
    if (b === RULE_MARKER) continue;
    if (b in RULE_SECTIONS) {
      section = RULE_SECTIONS[b as keyof typeof RULE_SECTIONS];
      topic.sections[section] = [];
      continue;
    }
    if (!section || exercise) throw new Error(`${at}: text outside a rule section: ${b}`);
    topic.sections[section]?.push(b);
  }
  return topics;
}

const answerKey = (topic: number, exercise: number, item: number) =>
  `topic ${topic}, exercise ${exercise}, item ${item}`;

function parseAnswers(workbook: Workbook): Map<string, string> {
  const answers = new Map<string, string>();
  for (const { row, cells } of workbook.rows(ANSWERS_SHEET).slice(1)) {
    const [topic, exercise, item] = [cells.A, cells.B, cells.C].map(Number);
    if (!topic || !exercise || !item || !cells.D) {
      throw new Error(`row ${row} of "${ANSWERS_SHEET}": incomplete answer`);
    }
    const key = answerKey(topic, exercise, item);
    if (answers.has(key)) throw new Error(`row ${row} of "${ANSWERS_SHEET}": duplicate ${key}`);
    answers.set(key, cells.D);
  }
  return answers;
}

export type GrammarCourse = {
  topics: GrammarTopicSeed[];
  /** Items without an answer and answers without an item; the course is only usable when empty. */
  mismatches: string[];
};

/**
 * Reads the grammar course and joins every exercise item with its answer. A missing answer or an
 * answer for no item is reported in `mismatches` (that item is left out of `topics`), never
 * dropped silently. A malformed sheet throws.
 */
export function parseGrammarCourse(workbook: Workbook): GrammarCourse {
  const answers = parseAnswers(workbook);
  const mismatches: string[] = [];
  const topics = parseTopics(workbook).map((topic) => {
    const exercises = topic.exercises.map((exercise) => ({
      ...exercise,
      items: exercise.items.flatMap((item) => {
        const key = answerKey(topic.position, exercise.number, item.number);
        const answer = answers.get(key);
        answers.delete(key);
        if (answer === undefined) {
          mismatches.push(`no answer for ${key}`);
          return [];
        }
        return [{ ...item, answer }];
      }),
    }));
    const parsed = grammarTopicSchema.safeParse({ ...topic, exercises });
    if (!parsed.success) {
      throw new Error(`grammar topic ${topic.position} is incomplete: ${parsed.error.message}`);
    }
    return parsed.data;
  });
  for (const key of answers.keys()) mismatches.push(`answer for no item: ${key}`);
  return { topics, mismatches };
}
