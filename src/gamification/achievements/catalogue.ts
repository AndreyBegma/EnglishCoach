import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type Locale, SUPPORTED_LOCALES } from "../../bot/i18n";
import type { CefrLevel } from "../../db/schema";
import type { SyllabusTopic } from "../../grammar/syllabus";
import { SYLLABUS } from "../../grammar/topics";
import { METRICS } from "./metrics";

/**
 * The achievements catalogue, declarative: `data/achievements/*.yaml` holds *series* (one metric,
 * ascending steps grouped by tier, title and description templates) and standalone entries (the
 * secret ones); the per-topic entries are generated from the grammar syllabus. Everything expands
 * into flat entries. It is validated when first loaded, and the bot loads it at boot, so an invalid
 * file fails boot.
 */

export const ACHIEVEMENTS_DIR = join(import.meta.dir, "..", "..", "..", "data", "achievements");

export const TIERS = ["bronze", "silver", "gold", "platinum", "legend"] as const;
export type Tier = (typeof TIERS)[number];

/** XP an unlock is worth when its entry names none. */
export const TIER_XP: Record<Tier, number> = {
  bronze: 10,
  silver: 25,
  gold: 50,
  platinum: 100,
  legend: 200,
};

export const CATEGORIES = [
  "words",
  "reviews",
  "grammar",
  "topics",
  "accuracy",
  "streaks",
  "progress",
  "levels",
  "sessions",
  "talk",
  "perfect",
  "habits",
  "seasonal",
  "secret",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Localized = Record<Locale, string>;

export interface Achievement {
  id: string;
  category: Category;
  metric: string;
  /** The counter the entry reads: the metric, or `metric.<key>` for a season or a topic. */
  counter: string;
  threshold: number;
  /** `cefr`: the counter is a band index (1 = A2 … 5 = C2), shown as the band. */
  format: "number" | "cefr";
  tier: Tier;
  emoji: string;
  xpReward: number;
  /** Hidden (title and description) until unlocked. */
  secret: boolean;
  title: Localized;
  description: Localized;
  /** The series the entry belongs to: the Achievements screen shows one line per series. */
  series: string;
  season?: Season;
}

export interface Season {
  id: string;
  /** Inclusive learner-local dates, `MM-DD`; a window may wrap the new year. */
  from: string;
  to: string;
}

const text = z.string().trim().min(1);
const localized = z.strictObject(
  Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, text])) as Record<
    Locale,
    typeof text
  >,
);
const slug = z.string().regex(/^[a-z][a-z0-9_]*$/, "lowercase letters, digits and _");
const monthDay = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "MM-DD");
const metric = z.string().refine((name) => METRICS.has(name), "unknown metric");
const tier = z.enum(TIERS);
const category = z.enum(CATEGORIES);
const xp = z.number().int().positive();

const seriesSchema = z.strictObject({
  id: slug,
  category,
  metric,
  emoji: text,
  season: z.strictObject({ id: slug, from: monthDay, to: monthDay }).optional(),
  /** `cefr` shows a threshold as its band (2 → B1) instead of a number. */
  format: z.enum(["number", "cefr"]).default("number"),
  secret: z.boolean().default(false),
  /** `{n}` is the step's threshold. */
  title: localized,
  description: localized,
  /** Thresholds by tier; each tier's list ascending, and every tier above the one before. */
  steps: z.partialRecord(tier, z.array(z.number().int().positive()).min(1)),
  xp: z.partialRecord(tier, xp).optional(),
});

const entrySchema = z.strictObject({
  id: slug,
  category,
  metric,
  threshold: z.number().int().positive(),
  tier,
  emoji: text,
  xp_reward: xp.optional(),
  secret: z.boolean().default(false),
  title: localized,
  description: localized,
});

export const catalogueFileSchema = z.strictObject({
  series: z.array(seriesSchema).default([]),
  entries: z.array(entrySchema).default([]),
});

export type CatalogueFile = z.infer<typeof catalogueFileSchema>;

export interface Catalogue {
  /** Every entry: the files' order, then the generated topic entries. */
  entries: readonly Achievement[];
  byId: ReadonlyMap<string, Achievement>;
  /** Entries by the counter they read, threshold ascending. */
  byCounter: ReadonlyMap<string, readonly Achievement[]>;
  /** Series ids in catalogue order. */
  series: readonly string[];
  seasons: readonly Season[];
}

const BAND_TIER: Record<CefrLevel, Tier> = {
  A1: "bronze",
  A2: "bronze",
  B1: "silver",
  B2: "gold",
  C1: "platinum",
  C2: "legend",
};

export const BAND_NAMES = ["A1", "A2", "B1", "B2", "C1", "C2"];

const fill = (template: Localized, n: string): Localized =>
  Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, template[locale].replaceAll("{n}", n)]),
  ) as Localized;

type Series = z.infer<typeof seriesSchema>;

function expandSeries(series: Series): Achievement[] {
  return TIERS.flatMap((tierName) =>
    (series.steps[tierName] ?? []).map((threshold) => {
      const shown =
        series.format === "cefr" ? (BAND_NAMES[threshold] ?? String(threshold)) : `${threshold}`;
      return {
        id: `${series.id}_${threshold}`,
        category: series.category,
        metric: series.metric,
        counter: series.season ? `${series.metric}.${series.season.id}` : series.metric,
        threshold,
        format: series.format,
        tier: tierName,
        emoji: series.emoji,
        xpReward: series.xp?.[tierName] ?? TIER_XP[tierName],
        secret: series.secret,
        title: fill(series.title, shown),
        description: fill(series.description, shown),
        series: series.id,
        ...(series.season ? { season: series.season } : {}),
      };
    }),
  );
}

/** XP for mastering a topic's achievement; the topic itself already earned `TOPIC_MASTERED_XP`. */
export const TOPIC_ACHIEVEMENT_XP = 15;

const TOPIC_TITLE: Localized = {
  en: "Mastered: {n}",
  ru: "Освоено: {n}",
  uk: "Опановано: {n}",
};
const TOPIC_DESCRIPTION: Localized = {
  en: "Master the grammar topic “{n}”",
  ru: "Освой тему грамматики «{n}»",
  uk: "Опануй тему граматики «{n}»",
};

/** One entry per syllabus topic, unlocked when the topic is mastered. */
export function topicEntries(topics: readonly SyllabusTopic[]): Achievement[] {
  return topics.map((topic) => ({
    id: `topic_${topic.id}`,
    category: "topics",
    metric: "topic_mastered",
    counter: `topic_mastered.${topic.id}`,
    threshold: 1,
    format: "number",
    tier: BAND_TIER[topic.band],
    emoji: "🧩",
    xpReward: TOPIC_ACHIEVEMENT_XP,
    secret: false,
    title: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        TOPIC_TITLE[locale].replace("{n}", topic.title[locale]),
      ]),
    ) as Localized,
    description: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        TOPIC_DESCRIPTION[locale].replace("{n}", topic.title[locale]),
      ]),
    ) as Localized,
    series: "topic_mastered",
  }));
}

/**
 * Validates and expands parsed files (with their names, for errors) plus the topic entries.
 * Throws naming every problem: an invalid file, a duplicate id, tiers or thresholds out of order.
 */
export function buildCatalogue(
  files: readonly { name: string; data: unknown }[],
  topics: readonly SyllabusTopic[],
): Catalogue {
  const problems: string[] = [];
  const entries: Achievement[] = [];
  const series: string[] = [];
  const seasons: Season[] = [];

  for (const { name, data } of files) {
    const parsed = catalogueFileSchema.safeParse(data ?? {});
    if (!parsed.success) {
      problems.push(`${name}: ${z.prettifyError(parsed.error)}`);
      continue;
    }
    for (const one of parsed.data.series) {
      series.push(one.id);
      if (one.season) seasons.push(one.season);
      entries.push(...expandSeries(one));
    }
    for (const entry of parsed.data.entries) {
      series.push(entry.id);
      entries.push({
        id: entry.id,
        category: entry.category,
        metric: entry.metric,
        counter: entry.metric,
        threshold: entry.threshold,
        format: "number",
        tier: entry.tier,
        emoji: entry.emoji,
        xpReward: entry.xp_reward ?? TIER_XP[entry.tier],
        secret: entry.secret,
        title: entry.title,
        description: entry.description,
        series: entry.id,
      });
    }
  }
  series.push("topic_mastered");
  entries.push(...topicEntries(topics));

  const byId = new Map<string, Achievement>();
  for (const entry of entries) {
    if (byId.has(entry.id)) problems.push(`duplicate achievement id ${entry.id}`);
    byId.set(entry.id, entry);
  }
  if (new Set(series).size !== series.length) problems.push("duplicate series id");

  const bySeries = Map.groupBy(entries, (entry) => entry.series);
  for (const [id, steps] of bySeries) {
    for (let i = 1; i < steps.length; i++) {
      const [before, after] = [steps[i - 1], steps[i]];
      if (!before || !after || id === "topic_mastered") continue;
      if (after.threshold <= before.threshold) {
        problems.push(`${id}: threshold ${after.threshold} does not rise over ${before.threshold}`);
      }
    }
  }
  if (problems.length > 0)
    throw new Error(`invalid achievements catalogue:\n${problems.join("\n")}`);

  const byCounter = new Map<string, Achievement[]>();
  for (const entry of entries) {
    const list = byCounter.get(entry.counter) ?? [];
    list.push(entry);
    byCounter.set(entry.counter, list);
  }
  for (const list of byCounter.values()) list.sort((a, b) => a.threshold - b.threshold);

  return { entries, byId, byCounter, series, seasons };
}

/** Reads and validates every `*.yaml` in `dir`, plus the syllabus topics. */
export function loadCatalogue(
  dir = ACHIEVEMENTS_DIR,
  topics: readonly SyllabusTopic[] = SYLLABUS.topics,
): Catalogue {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  if (names.length === 0) throw new Error(`no achievements files in ${dir}`);
  return buildCatalogue(
    names.map((name) => ({ name, data: Bun.YAML.parse(readFileSync(join(dir, name), "utf8")) })),
    topics,
  );
}

let loaded: Catalogue | undefined;

/** The catalogue, loaded on first use; the bot calls it at boot so a bad file fails there. */
export function achievementCatalogue(): Catalogue {
  loaded ??= loadCatalogue();
  return loaded;
}
