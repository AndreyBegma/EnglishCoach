import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SUPPORTED_LOCALES } from "../bot/i18n";
import type { CefrLevel } from "../db/schema";
import { CEFR_LEVELS } from "../settings/options";
import { grammarItemType } from "../skills/schemas";

/**
 * The grammar syllabus: one topic map from A1 to C2, keyed by the owner's course ids (`g001`…).
 * The owner's rule text and exercises stay in `seed/grammar`; the syllabus adds what the app
 * needs to plan and generate practice — a fine level, titles in every UI locale, prerequisites,
 * contrasts, examples and the mistakes Russian and Ukrainian speakers typically make.
 */

export const SYLLABUS_DIR = join(import.meta.dir, "..", "..", "data", "grammar", "syllabus");

const line = z.string().trim().min(1);
const topicIdSchema = z.string().regex(/^g\d{3}$/, "a topic id is g + three digits");

/** `B1.4`: the CEFR band, then the step inside it (1 = its start, 9 = its end). */
const LEVEL = /^(A1|A2|B1|B2|C1|C2)\.([1-9])$/;

const titleSchema = z.strictObject(
  Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, line])) as Record<
    (typeof SUPPORTED_LOCALES)[number],
    typeof line
  >,
);

const fileTopicSchema = z.strictObject({
  level: z.string().regex(LEVEL, "level is a CEFR band and a step, e.g. B1.4"),
  title: titleSchema,
  prerequisites: z.array(topicIdSchema).default([]),
  contrast_with: z.array(topicIdSchema).default([]),
  examples: z.array(line).min(2),
  /** Typical mistakes of Russian and Ukrainian speakers, and why they make them. */
  interference: z.array(z.strictObject({ wrong: line, right: line, cause: line })).min(1),
  exercise_types: z.array(grammarItemType).min(1),
});

export const syllabusFileSchema = z.record(topicIdSchema, fileTopicSchema);

export type SyllabusTopic = {
  id: string;
  band: CefrLevel;
  /** Step inside the band, 1-9. */
  step: number;
  /** As written, e.g. `B1.4`. */
  level: string;
  title: z.infer<typeof titleSchema>;
  prerequisites: string[];
  contrastWith: string[];
  examples: string[];
  interference: { wrong: string; right: string; cause: string }[];
  exerciseTypes: z.infer<typeof grammarItemType>[];
};

export type Syllabus = {
  /** Every topic, ordered by level, then id. */
  topics: readonly SyllabusTopic[];
  byId: ReadonlyMap<string, SyllabusTopic>;
};

/** Orders levels: a lower band first, then a lower step. */
export const levelRank = (topic: Pick<SyllabusTopic, "band" | "step">) =>
  CEFR_LEVELS.indexOf(topic.band) * 10 + topic.step;

function toTopic(id: string, raw: z.infer<typeof fileTopicSchema>): SyllabusTopic {
  const [, band = "", step = ""] = raw.level.match(LEVEL) ?? [];
  return {
    id,
    band: band as CefrLevel,
    step: Number(step),
    level: raw.level,
    title: raw.title,
    prerequisites: raw.prerequisites,
    contrastWith: raw.contrast_with,
    examples: raw.examples,
    interference: raw.interference,
    exerciseTypes: raw.exercise_types,
  };
}

/** The first prerequisite cycle found, as a path that starts and ends on the same id. */
function findCycle(byId: ReadonlyMap<string, SyllabusTopic>): string[] | null {
  const done = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();
  const visit = (id: string): string[] | null => {
    if (onPath.has(id)) return [...path.slice(path.indexOf(id)), id];
    if (done.has(id)) return null;
    onPath.add(id);
    path.push(id);
    for (const next of byId.get(id)?.prerequisites ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    onPath.delete(id);
    done.add(id);
    return null;
  };
  for (const id of byId.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Validates parsed syllabus files (one object per file, keyed by topic id) and builds the
 * syllabus. Throws one error listing every problem: an id defined twice, a reference to an
 * unknown or to the same topic, a prerequisite above its topic's level, a prerequisite cycle.
 */
export function buildSyllabus(files: readonly { name: string; data: unknown }[]): Syllabus {
  const problems: string[] = [];
  const byId = new Map<string, SyllabusTopic>();
  for (const { name, data } of files) {
    const parsed = syllabusFileSchema.safeParse(data);
    if (!parsed.success) {
      problems.push(`${name}: ${z.prettifyError(parsed.error)}`);
      continue;
    }
    for (const [id, raw] of Object.entries(parsed.data)) {
      if (byId.has(id)) problems.push(`${name}: ${id} is defined twice`);
      else byId.set(id, toTopic(id, raw));
    }
  }

  for (const topic of byId.values()) {
    const refs = [
      ...topic.prerequisites.map((id) => ["prerequisite", id] as const),
      ...topic.contrastWith.map((id) => ["contrast", id] as const),
    ];
    for (const [kind, id] of refs) {
      const other = byId.get(id);
      if (id === topic.id) problems.push(`${topic.id}: ${kind} ${id} is the topic itself`);
      else if (!other) problems.push(`${topic.id}: unknown ${kind} ${id}`);
      else if (kind === "prerequisite" && levelRank(other) > levelRank(topic)) {
        problems.push(`${topic.id}: prerequisite ${id} (${other.level}) is above ${topic.level}`);
      }
    }
  }
  const cycle = findCycle(byId);
  if (cycle) problems.push(`prerequisite cycle: ${cycle.join(" → ")}`);

  if (problems.length > 0) {
    throw new Error(`invalid grammar syllabus:\n${problems.join("\n")}`);
  }
  const topics = [...byId.values()].sort(
    (a, b) => levelRank(a) - levelRank(b) || a.id.localeCompare(b.id),
  );
  return { topics, byId };
}

/** Reads and validates every `*.yaml` in `dir`. Throws on any invalid file. */
export function loadSyllabus(dir = SYLLABUS_DIR): Syllabus {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  if (names.length === 0) throw new Error(`no grammar syllabus files in ${dir}`);
  return buildSyllabus(
    names.map((name) => ({ name, data: Bun.YAML.parse(readFileSync(join(dir, name), "utf8")) })),
  );
}
