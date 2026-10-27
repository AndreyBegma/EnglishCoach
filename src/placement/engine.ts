import type { CefrLevel, Skill } from "../db/schema";
import {
  bandCentre,
  bandOf,
  type LevelState,
  overall,
  PRIOR,
  SEEDED_UNCERTAINTY,
  update,
} from "../levels/model";
import { PLACEMENT_SECTIONS, type PlacementSection } from "../skills/schemas";

/**
 * The adaptive engine of the full placement test, pure. The server owns the adaptivity: every
 * item is pitched at the band of the section's running rating, and every graded answer moves
 * that rating with the level model's own `update` (IRT-lite), so a correct answer sends the next
 * item up and a wrong one down. The model only writes items and grades free production.
 */

/** Items per section: questions for grammar/vocabulary, texts/clips for reading/listening. */
export const SECTION_ITEMS: Record<PlacementSection, number> = {
  grammar: 7,
  vocabulary: 7,
  reading: 2,
  listening: 2,
  writing: 1,
  speaking: 1,
};

/** Where a section after the first starts: the test's level so far, still open to move fast. */
export const SECTION_START_UNCERTAINTY = 1;

/** How sure a rubric-graded level (writing, speaking) is: one task, judged on its descriptors. */
export const RUBRIC_UNCERTAINTY = SEEDED_UNCERTAINTY.placement;

/** A section's outcome: the skill's level, the evidence behind it, and how it was reached. */
export type SectionResult = LevelState & {
  evidence: number;
  /** Not measured (no voice, or the learner skipped it): seeded from the measured skills. */
  skipped: boolean;
  /** The rubric's one-line strength and gap, in the explanation language (writing, speaking). */
  feedback?: string;
};

/** A grammar answer on a syllabus topic, for the topic flags. */
export type TopicAnswer = { topicId: string; correct: boolean };

/** The test's progress. Lives in the flow state (Redis) and is written nowhere until the end. */
export interface PlacementProgress {
  /** Index into `PLACEMENT_SECTIONS` of the section being taken. */
  section: number;
  /** Items finished in the current section. */
  done: number;
  /** The current section's running level. */
  current: LevelState;
  /** Graded answers in the current section. */
  evidence: number;
  results: Partial<Record<PlacementSection, SectionResult>>;
  /** Subjects, topics and words already used, for the item skill's `avoid`. */
  used: string[];
  topics: TopicAnswer[];
}

export function startProgress(): PlacementProgress {
  return {
    section: 0,
    done: 0,
    current: { ...PRIOR },
    evidence: 0,
    results: {},
    used: [],
    topics: [],
  };
}

/** The section being taken, or undefined once the test is over. */
export function currentSection(progress: PlacementProgress): PlacementSection | undefined {
  return PLACEMENT_SECTIONS[progress.section];
}

export function isFinished(progress: PlacementProgress): boolean {
  return currentSection(progress) === undefined;
}

/** The band the next item is pitched at. */
export function targetLevel(progress: PlacementProgress): CefrLevel {
  return bandOf(progress.current.rating);
}

/** The level measured so far, from the sections that were not skipped. */
export function measuredLevel(progress: PlacementProgress): LevelState | undefined {
  const measured = Object.fromEntries(
    Object.entries(progress.results).filter(([, result]) => !result.skipped),
  ) as Partial<Record<Skill, LevelState>>;
  return overall(measured);
}

/** One graded question of the current item, pitched at `level`; a grammar item names its topic. */
export function scoreAnswer(
  progress: PlacementProgress,
  level: CefrLevel,
  correct: boolean,
  topicId: string | null = null,
): PlacementProgress {
  return {
    ...progress,
    current: update(progress.current, bandCentre(level), correct ? 1 : 0),
    evidence: progress.evidence + 1,
    topics: topicId ? [...progress.topics, { topicId, correct }] : progress.topics,
  };
}

/** Marks the current item done, and closes the section when it was its last. */
export function completeItem(progress: PlacementProgress, subject: string): PlacementProgress {
  const section = currentSection(progress);
  if (!section) return progress;
  const next = { ...progress, done: progress.done + 1, used: remember(progress.used, subject) };
  if (next.done < SECTION_ITEMS[section]) return next;
  return closeSection(next, section, {
    rating: next.current.rating,
    uncertainty: next.current.uncertainty,
    evidence: next.evidence,
    skipped: false,
  });
}

/** A rubric-graded task (writing, speaking): the level the answer shows. */
export function gradeTask(
  progress: PlacementProgress,
  level: CefrLevel,
  feedback: string,
  subject: string,
): PlacementProgress {
  const section = currentSection(progress);
  if (!section) return progress;
  return closeSection({ ...progress, used: remember(progress.used, subject) }, section, {
    rating: bandCentre(level),
    uncertainty: RUBRIC_UNCERTAINTY,
    evidence: 1,
    skipped: false,
    feedback,
  });
}

/**
 * Skips the current section: its skill starts at the level measured so far, as unsure as a
 * level the learner chose, and with no evidence (the Profile marks it `~`).
 */
export function skipSection(progress: PlacementProgress): PlacementProgress {
  const section = currentSection(progress);
  if (!section) return progress;
  const measured = measuredLevel(progress) ?? PRIOR;
  return closeSection(progress, section, {
    rating: measured.rating,
    uncertainty: SEEDED_UNCERTAINTY.chosen,
    evidence: 0,
    skipped: true,
  });
}

function closeSection(
  progress: PlacementProgress,
  section: PlacementSection,
  result: SectionResult,
): PlacementProgress {
  const results = { ...progress.results, [section]: result };
  const next = { ...progress, section: progress.section + 1, done: 0, evidence: 0, results };
  const start = measuredLevel(next) ?? PRIOR;
  return {
    ...next,
    current: { rating: start.rating, uncertainty: SECTION_START_UNCERTAINTY },
  };
}

/** Keeps the most recent subjects, as many as the item skill takes. */
const MAX_USED = 20;

function remember(used: readonly string[], subject: string): string[] {
  const kept = used.filter((item) => item.toLowerCase() !== subject.toLowerCase());
  return [...kept, subject].slice(-MAX_USED);
}

/** Every skill's result once the test is over; undefined while it is not. */
export function finalResults(
  progress: PlacementProgress,
): Record<PlacementSection, SectionResult> | undefined {
  if (!isFinished(progress)) return undefined;
  const results = progress.results;
  for (const section of PLACEMENT_SECTIONS) if (!results[section]) return undefined;
  return results as Record<PlacementSection, SectionResult>;
}
