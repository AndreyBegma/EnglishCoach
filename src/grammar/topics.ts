import type { CefrLevel } from "../db/schema";
import { CEFR_LEVELS } from "../settings/options";
import { loadSyllabus, type SyllabusTopic } from "./syllabus";

/**
 * The grammar syllabus, read once when the module loads: an invalid syllabus file fails boot
 * instead of the first grammar session.
 */
export const SYLLABUS = loadSyllabus();

/** Learners who have not taken the placement test are treated as intermediate. */
export const DEFAULT_TOPIC_LEVEL: CefrLevel = "B1";

/** The topics offered at `level`: its CEFR band, in syllabus order. */
export function topicsForLevel(level: CefrLevel | null): SyllabusTopic[] {
  const band = level ?? DEFAULT_TOPIC_LEVEL;
  return SYLLABUS.topics.filter((topic) => topic.band === band);
}

export function topicById(id: string): SyllabusTopic | undefined {
  return SYLLABUS.byId.get(id);
}

/** A topic id a model named, kept only when it is in the syllabus. */
export function knownTopicId(id: string | null | undefined): string | null {
  return id && SYLLABUS.byId.has(id) ? id : null;
}

/**
 * The topics a model may name for a learner at `level`: its band and the bands next to it, as
 * `{id, title}` with the English title.
 */
export function topicChoices(level: CefrLevel | null): { id: string; title: string }[] {
  const at = CEFR_LEVELS.indexOf(level ?? DEFAULT_TOPIC_LEVEL);
  return SYLLABUS.topics
    .filter((topic) => Math.abs(CEFR_LEVELS.indexOf(topic.band) - at) <= 1)
    .map((topic) => ({ id: topic.id, title: topic.title.en }));
}
