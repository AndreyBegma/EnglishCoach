import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { notInArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import {
  grammarExerciseItems,
  grammarExercises,
  grammarTopics,
  phrasalVerbs,
  studyPlanDays,
} from "../db/schema";
import {
  type GrammarTopicSeed,
  grammarTopicSchema,
  parseGrammarCourse,
} from "../grammar/seed-course";
import {
  type PhrasalVerbSeed,
  type PlanDaySeed,
  parsePhrasalVerbs,
  parsePlan,
  phrasalVerbSchema,
  planDaySchema,
} from "./owner-extras";
import { importOwnerList, type OwnerImportResult } from "./owner-import";
import {
  type ExcludedEntry,
  OWNER_SHEETS,
  ownerWordSchema,
  parseOwnerWorkbook,
} from "./owner-list";
import { Workbook } from "./xlsx";

/**
 * The owner's content committed as seed data (`seed/`), generated from the owner's workbook by
 * `bun run seed:generate` and loaded by `bun run db:seed`.
 *
 * The word sheets' `Пример` column is never part of it: those sentences come from Oxford
 * dictionaries and the repository is public. They reach the database only through
 * `db:import:owner-words` from the private workbook, and loading the seed leaves them in place.
 */

/** A word of the owner's list as committed: everything but the example sentence. */
export const seedWordSchema = z.strictObject(ownerWordSchema.omit({ example: true }).shape);
export type SeedWord = z.infer<typeof seedWordSchema>;

export const removedEntrySchema = z.strictObject({
  lemma: z.string().min(1),
  reason: z.string().min(1).nullable(),
});

export type OwnerSeed = {
  words: SeedWord[];
  removed: ExcludedEntry[];
  grammar: GrammarTopicSeed[];
  phrasalVerbs: PhrasalVerbSeed[];
  plan: PlanDaySeed[];
};

/** Reads the workbook into the seed; `mismatches` lists exercise items and answers that do not pair. */
export function buildOwnerSeed(bytes: Uint8Array): { seed: OwnerSeed; mismatches: string[] } {
  const list = parseOwnerWorkbook(bytes);
  const workbook = new Workbook(bytes);
  const course = parseGrammarCourse(workbook);
  return {
    seed: {
      words: list.words.map(({ example: _, ...word }) => word),
      removed: list.removed,
      grammar: course.topics,
      phrasalVerbs: parsePhrasalVerbs(workbook),
      plan: parsePlan(workbook),
    },
    mismatches: course.mismatches,
  };
}

const wordsFile = (stage: number) => `words/stage-${stage}.json`;
const REMOVED_FILE = "removed.json";
const GRAMMAR_DIR = "grammar";
const PHRASAL_VERBS_FILE = "phrasal-verbs.json";
const PLAN_FILE = "plan.json";

/**
 * The seed as files (path relative to `seed/` → JSON text): one file per word stage and per
 * grammar topic, so every file stays small and a change to the workbook shows as a local diff.
 */
export function ownerSeedFiles(seed: OwnerSeed): Record<string, string> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const files: Record<string, string> = {};
  OWNER_SHEETS.forEach((_, stage) => {
    files[wordsFile(stage)] = json(seed.words.filter((word) => word.stage === stage));
  });
  files[REMOVED_FILE] = json(seed.removed);
  for (const topic of seed.grammar) files[`${GRAMMAR_DIR}/${topic.id}.json`] = json(topic);
  files[PHRASAL_VERBS_FILE] = json(seed.phrasalVerbs);
  files[PLAN_FILE] = json(seed.plan);
  return files;
}

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await Bun.file(path).json());
  if (!parsed.success) throw new Error(`invalid seed file ${path}: ${parsed.error.message}`);
  return parsed.data;
}

/** Reads and validates the committed seed; an unknown field (an example on a word) throws. */
export async function readOwnerSeed(dir: string): Promise<OwnerSeed> {
  const words: SeedWord[] = [];
  for (const [stage] of OWNER_SHEETS.entries()) {
    words.push(...(await readJson(join(dir, wordsFile(stage)), z.array(seedWordSchema))));
  }
  const grammar: GrammarTopicSeed[] = [];
  for (const name of (await readdir(join(dir, GRAMMAR_DIR))).sort()) {
    if (name.endsWith(".json")) {
      grammar.push(await readJson(join(dir, GRAMMAR_DIR, name), grammarTopicSchema));
    }
  }
  return {
    words,
    removed: await readJson(join(dir, REMOVED_FILE), z.array(removedEntrySchema)),
    grammar: grammar.sort((a, b) => a.position - b.position),
    phrasalVerbs: await readJson(join(dir, PHRASAL_VERBS_FILE), z.array(phrasalVerbSchema)),
    plan: await readJson(join(dir, PLAN_FILE), z.array(planDaySchema)),
  };
}

/** `set` of an upsert: each listed column takes the value of the proposed row. */
const excluded = (columns: string[]): Record<string, SQL> =>
  Object.fromEntries(
    columns.map((key) => [
      key,
      sql.raw(`excluded.${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`),
    ]),
  );

export type OwnerSeedResult = OwnerImportResult & {
  topics: number;
  exercises: number;
  items: number;
  phrasalVerbs: number;
  planDays: number;
};

/**
 * Loads the seed idempotently. Words go through the owner-list import without examples (an
 * example the private import set stays). The course, phrasal verbs and plan are upserted on their
 * keys, so ids stay stable across reloads, and rows the seed no longer has are deleted.
 */
export async function loadOwnerSeed(db: Db, seed: OwnerSeed): Promise<OwnerSeedResult> {
  const imported = await importOwnerList(
    db,
    { words: seed.words.map((word) => ({ ...word, example: null })), removed: seed.removed },
    { examples: false },
  );

  return db.transaction(async (tx) => {
    const topics = seed.grammar.map(({ sections, exercises: _, ...topic }) => ({
      ...topic,
      why: sections.why.join("\n"),
      formation: sections.formation.join("\n"),
      usage: sections.usage.join("\n"),
      signalWords: sections.signalWords.join("\n"),
      mistakes: sections.mistakes.join("\n"),
      remember: sections.remember.join("\n"),
    }));
    await tx
      .insert(grammarTopics)
      .values(topics)
      .onConflictDoUpdate({
        target: grammarTopics.id,
        set: excluded([
          "position",
          "cefrLevel",
          "title",
          "plannedFrom",
          "plannedTo",
          "why",
          "formation",
          "usage",
          "signalWords",
          "mistakes",
          "remember",
        ]),
      });
    await tx.delete(grammarTopics).where(
      notInArray(
        grammarTopics.id,
        topics.map((topic) => topic.id),
      ),
    );

    const exercises = await tx
      .insert(grammarExercises)
      .values(
        seed.grammar.flatMap((topic) =>
          topic.exercises.map(({ number, instruction }) => ({
            topicId: topic.id,
            number,
            instruction,
          })),
        ),
      )
      .onConflictDoUpdate({
        target: [grammarExercises.topicId, grammarExercises.number],
        set: excluded(["instruction"]),
      })
      .returning({
        id: grammarExercises.id,
        topicId: grammarExercises.topicId,
        number: grammarExercises.number,
      });
    await tx.delete(grammarExercises).where(
      notInArray(
        grammarExercises.id,
        exercises.map((row) => row.id),
      ),
    );

    const exerciseId = new Map(exercises.map((row) => [`${row.topicId}/${row.number}`, row.id]));
    const items = await tx
      .insert(grammarExerciseItems)
      .values(
        seed.grammar.flatMap((topic) =>
          topic.exercises.flatMap((exercise) => {
            const id = exerciseId.get(`${topic.id}/${exercise.number}`);
            if (id === undefined) throw new Error(`exercise ${exercise.number} of ${topic.id}`);
            return exercise.items.map((item) => ({ exerciseId: id, ...item }));
          }),
        ),
      )
      .onConflictDoUpdate({
        target: [grammarExerciseItems.exerciseId, grammarExerciseItems.number],
        set: excluded(["prompt", "answer"]),
      })
      .returning({ id: grammarExerciseItems.id });
    await tx.delete(grammarExerciseItems).where(
      notInArray(
        grammarExerciseItems.id,
        items.map((row) => row.id),
      ),
    );

    await tx
      .insert(phrasalVerbs)
      .values(seed.phrasalVerbs)
      .onConflictDoUpdate({
        target: phrasalVerbs.number,
        set: excluded(["phrase", "translationRu", "example", "planDay"]),
      });
    await tx.delete(phrasalVerbs).where(
      notInArray(
        phrasalVerbs.number,
        seed.phrasalVerbs.map((verb) => verb.number),
      ),
    );

    await tx
      .insert(studyPlanDays)
      .values(seed.plan)
      .onConflictDoUpdate({
        target: studyPlanDays.day,
        set: excluded([
          "date",
          "week",
          "stage",
          "wordTopic",
          "wordCount",
          "reviewWords",
          "phrasalVerbs",
          "grammar",
        ]),
      });
    await tx.delete(studyPlanDays).where(
      notInArray(
        studyPlanDays.day,
        seed.plan.map((day) => day.day),
      ),
    );

    return {
      ...imported,
      topics: topics.length,
      exercises: exercises.length,
      items: items.length,
      phrasalVerbs: seed.phrasalVerbs.length,
      planDays: seed.plan.length,
    };
  });
}
