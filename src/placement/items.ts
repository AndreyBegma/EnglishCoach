import type { Db } from "../db/client";
import { randomLemmas } from "../db/repositories/words";
import type { CefrLevel } from "../db/schema";
import type { SyllabusTopic } from "../grammar/syllabus";
import type { SkillOutput, SkillRunner, SkillVars } from "../skills";
import type { PlacementSection } from "../skills/schemas";
import { currentSection, type PlacementProgress, targetLevel } from "./engine";
import { nextTopic } from "./topics";

export type PlacementItemOutput = SkillOutput<"placement-item">;

/** The item on screen: what the skill wrote, plus what the server pitched it at. */
export interface PlacementItem {
  section: PlacementSection;
  level: CefrLevel;
  /** Grammar: the syllabus topic it tests. */
  topicId: string | null;
  subject: string;
  passage: string | null;
  questions: PlacementItemOutput["questions"];
  task: string | null;
}

/** The skill returned something the test cannot use. A model bug, not a user error. */
export class PlacementError extends Error {
  override name = "PlacementError";
}

export interface ItemDeps {
  db: Db;
  skills: SkillRunner;
  /** The syllabus the grammar items sample; the grammar module's in production. */
  topics: readonly SyllabusTopic[];
  /** Index picker for the topic and word choice; tests pin it. */
  pick?: (count: number) => number;
}

/** Dictionary words offered per vocabulary item; one not used yet is tested. */
const WORD_CANDIDATES = 8;

/** Asks the item skill for the current section's next item, at the band the engine targets. */
export async function nextItem(
  deps: ItemDeps,
  userId: number,
  progress: PlacementProgress,
): Promise<PlacementItem> {
  const section = currentSection(progress);
  if (!section) throw new PlacementError("the test is over");
  const level = targetLevel(progress);
  const vars: SkillVars<"placement-item"> = { section, level, avoid: progress.used };

  let topicId: string | null = null;
  if (section === "grammar") {
    const topic = nextTopic(deps.topics, level, progress.topics, deps.pick);
    if (topic) {
      topicId = topic.id;
      vars.topic = { id: topic.id, title: topic.title.en, examples: topic.examples.slice(0, 5) };
    }
  }
  if (section === "vocabulary") {
    vars.word = await unusedWord(deps.db, level, progress.used);
  }

  const { data } = await deps.skills.runSkill(userId, "placement-item", vars);
  if (data.section !== section) {
    throw new PlacementError(`asked for ${section}, got ${data.section}`);
  }
  return {
    section,
    level,
    topicId,
    subject: topicId ?? vars.word ?? data.subject,
    passage: data.passage,
    questions: data.questions,
    task: data.task,
  };
}

async function unusedWord(
  db: Db,
  level: CefrLevel,
  used: readonly string[],
): Promise<string | null> {
  const seen = new Set(used.map((item) => item.toLowerCase()));
  const lemmas = await randomLemmas(db, level, "", WORD_CANDIDATES);
  return lemmas.find((lemma) => !seen.has(lemma.toLowerCase())) ?? null;
}

/** The rubric skills, by section. */
const RUBRIC_SKILL = { writing: "writing-rubric", speaking: "speaking-rubric" } as const;

export type RubricGrade = SkillOutput<"writing-rubric">;

/** Grades a writing or speaking answer against its task. Off-task answers show A1. */
export async function gradeAnswer(
  skills: SkillRunner,
  userId: number,
  item: PlacementItem,
  answer: string,
): Promise<RubricGrade> {
  if (item.section !== "writing" && item.section !== "speaking") {
    throw new PlacementError(`${item.section} has no rubric`);
  }
  if (!item.task) throw new PlacementError(`${item.section} item without a task`);
  const { data } = await skills.runSkill(userId, RUBRIC_SKILL[item.section], {
    task: item.task,
    level: item.level,
    learner_answer: answer,
  });
  return data.on_task ? data : { ...data, level: "A1" };
}
