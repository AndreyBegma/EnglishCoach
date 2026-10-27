import { date, integer, pgTable, smallint, text, unique } from "drizzle-orm/pg-core";
import { cefrLevelEnum } from "./enums";

/**
 * The owner's own course, loaded from the committed seed (`seed/`, see `src/words/owner-seed.ts`)
 * by `bun run db:seed`. The seed owns these tables: a reload replaces their contents.
 */

/** One topic of the owner's grammar course; the rule text is in Russian, one section per column. */
export const grammarTopics = pgTable("grammar_topics", {
  /** Stable id (`g001`…): the syllabus, the item bank and callbacks refer to it. */
  id: text().primaryKey(),
  /** The owner's topic number ("Тема N"): the course order. */
  position: smallint().notNull().unique(),
  cefrLevel: cefrLevelEnum().notNull(),
  title: text().notNull(),
  /** The owner's plan dates for the topic. */
  plannedFrom: date({ mode: "string" }),
  plannedTo: date({ mode: "string" }),
  /** ЗАЧЕМ ЭТО НУЖНО */
  why: text().notNull(),
  /** КАК ОБРАЗУЕТСЯ */
  formation: text().notNull(),
  /** КОГДА ИСПОЛЬЗУЕМ */
  usage: text().notNull(),
  /** СЛОВА-ПОДСКАЗКИ */
  signalWords: text().notNull(),
  /** ЧАСТЫЕ ОШИБКИ */
  mistakes: text().notNull(),
  /** ЗАПОМНИ */
  remember: text().notNull(),
});

export const grammarExercises = pgTable(
  "grammar_exercises",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    topicId: text()
      .notNull()
      .references(() => grammarTopics.id, { onDelete: "cascade" }),
    number: smallint().notNull(),
    instruction: text().notNull(),
  },
  (table) => [unique("grammar_exercises_topic_number_unique").on(table.topicId, table.number)],
);

/** A verified exercise item: the owner's prompt and answer ("a / b" lists accepted variants). */
export const grammarExerciseItems = pgTable(
  "grammar_exercise_items",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    exerciseId: integer()
      .notNull()
      .references(() => grammarExercises.id, { onDelete: "cascade" }),
    number: smallint().notNull(),
    prompt: text().notNull(),
    answer: text().notNull(),
  },
  (table) => [
    unique("grammar_exercise_items_exercise_number_unique").on(table.exerciseId, table.number),
  ],
);

/** The owner's phrasal verbs with their own example sentences. */
export const phrasalVerbs = pgTable("phrasal_verbs", {
  /** The owner's row number (№): the learning order. */
  number: smallint().primaryKey(),
  phrase: text().notNull(),
  translationRu: text().notNull(),
  example: text(),
  /** Day of the owner's plan the verb is scheduled for. */
  planDay: smallint(),
});

/** The owner's daily plan (sheet `План`), kept as reference data. */
export const studyPlanDays = pgTable("study_plan_days", {
  /** 1-based day of the plan. */
  day: smallint().primaryKey(),
  date: date({ mode: "string" }).notNull(),
  week: smallint().notNull(),
  stage: text().notNull(),
  wordTopic: text(),
  wordCount: smallint(),
  /** Which earlier days' words to review, as the owner wrote it ("19.10, 12.10"). */
  reviewWords: text(),
  /** Phrasal-verb range for the day ("№ 1–3"). */
  phrasalVerbs: text(),
  grammar: text(),
});

export type GrammarTopicRow = typeof grammarTopics.$inferSelect;
export type GrammarExerciseRow = typeof grammarExercises.$inferSelect;
export type GrammarExerciseItemRow = typeof grammarExerciseItems.$inferSelect;
export type PhrasalVerbRow = typeof phrasalVerbs.$inferSelect;
export type StudyPlanDayRow = typeof studyPlanDays.$inferSelect;
