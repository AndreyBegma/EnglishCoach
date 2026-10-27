import { InlineKeyboard } from "grammy";
import type { Locale, Translator } from "../../bot/i18n";
import type { Db } from "../../db/client";
import { getCounters, listUnlocks, listUnnotified } from "../../db/repositories/achievements";
import { encodeProgressCallback } from "../../progress/callbacks";
import { MAX_MESSAGE_LENGTH } from "../../progress/render";
import { xpBar } from "../profile";
import {
  type Achievement,
  achievementCatalogue,
  BAND_NAMES,
  type Catalogue,
  type Tier,
} from "./catalogue";

export const TIER_MARK: Record<Tier, string> = {
  bronze: "🥉",
  silver: "🥈",
  gold: "🥇",
  platinum: "💠",
  legend: "👑",
};

/** An unlocked entry as one short line: emoji and title in the learner's locale. */
export const achievementLine = (entry: Achievement, locale: Locale) =>
  `${entry.emoji} ${entry.title[locale]}`;

/** The latest unlocks as lines, newest first (the Profile screen's "latest achievements"). */
export async function latestAchievements(
  db: Db,
  userId: number,
  locale: Locale,
  limit: number,
  catalogue: Catalogue = achievementCatalogue(),
): Promise<string[]> {
  const rows = await listUnlocks(db, userId, limit);
  return rows.flatMap((row) => {
    const entry = catalogue.byId.get(row.achievementId);
    return entry ? [achievementLine(entry, locale)] : [];
  });
}

/** Unlocks the hub has not shown yet, oldest first; ids that left the catalogue are skipped. */
export async function pendingUnlocks(
  db: Db,
  userId: number,
  catalogue: Catalogue = achievementCatalogue(),
): Promise<{ ids: string[]; entries: Achievement[] }> {
  const rows = await listUnnotified(db, userId);
  return {
    ids: rows.map((row) => row.achievementId),
    entries: rows.flatMap((row) => catalogue.byId.get(row.achievementId) ?? []),
  };
}

/** Shown on the hub at most this many by name; the rest as "+N". */
export const NOTICE_NAMES = 3;

/** The hub's one line about new unlocks, or undefined when there are none. */
export function unlockNotice(
  i18n: Translator,
  locale: Locale,
  entries: readonly Achievement[],
): string | undefined {
  if (entries.length === 0) return undefined;
  const names = entries.slice(0, NOTICE_NAMES).map((entry) => achievementLine(entry, locale));
  const more = entries.length - names.length;
  const list = names.join(", ");
  return i18n.t(locale, "hub-achievements-unlocked", {
    list: more > 0 ? i18n.t(locale, "hub-achievements-more", { list, count: more }) : list,
  });
}

export interface AchievementsData {
  unlocked: ReadonlySet<string>;
  counters: ReadonlyMap<string, number>;
}

export async function loadAchievements(db: Db, userId: number): Promise<AchievementsData> {
  const [rows, counters] = await Promise.all([listUnlocks(db, userId), getCounters(db, userId)]);
  return { unlocked: new Set(rows.map((row) => row.achievementId)), counters };
}

/** Series per page of the Achievements screen. */
export const PAGE_SERIES = 8;

const shown = (entry: Achievement, value: number) =>
  entry.format === "cefr" ? (BAND_NAMES[value] ?? String(value)) : String(value);

/** A screen row: the lines of one series, or the topics and secrets summaries. */
function rows(
  t: (key: string, variables?: Record<string, string | number>) => string,
  locale: Locale,
  catalogue: Catalogue,
  data: AchievementsData,
): string[][] {
  const bySeries = Map.groupBy(catalogue.entries, (entry) => entry.series);
  const result: string[][] = [];
  const topics = bySeries.get("topic_mastered") ?? [];
  result.push([
    t("achievements-topics", {
      count: topics.filter((entry) => data.unlocked.has(entry.id)).length,
      total: topics.length,
    }),
  ]);

  for (const id of catalogue.series) {
    const entries = (bySeries.get(id) ?? []).filter((entry) => !entry.secret);
    if (id === "topic_mastered" || entries.length === 0) continue;
    const done = entries.filter((entry) => data.unlocked.has(entry.id));
    const latest = done.at(-1);
    const next = entries.find((entry) => !data.unlocked.has(entry.id));
    const lines: string[] = [];
    if (latest) {
      lines.push(
        `${achievementLine(latest, locale)} ${TIER_MARK[latest.tier]}${next ? "" : " ✅"}`,
      );
    }
    if (next) {
      const value = Math.min(data.counters.get(next.counter) ?? 0, next.threshold);
      const progress = t("achievements-progress", {
        bar: xpBar(value, next.threshold),
        value: shown(next, value),
        threshold: shown(next, next.threshold),
        title: next.title[locale],
      });
      lines.push(latest ? `    ${progress}` : `${next.emoji} ${progress}`);
    }
    result.push(lines);
  }

  const secrets = catalogue.entries.filter((entry) => entry.secret);
  const found = secrets.filter((entry) => data.unlocked.has(entry.id));
  result.push([
    t("achievements-secrets", { count: found.length, total: secrets.length }),
    ...found.map((entry) => `    ${achievementLine(entry, locale)}`),
  ]);
  return result;
}

/** Profile → Achievements: unlocked count, then per series the latest unlock and the next step. */
export function renderAchievements(
  i18n: Translator,
  locale: Locale,
  data: AchievementsData,
  page: number,
  catalogue: Catalogue = achievementCatalogue(),
): { text: string; keyboard: InlineKeyboard } {
  const t = (key: string, variables?: Record<string, string | number>) =>
    i18n.t(locale, key, variables);
  const all = rows(t, locale, catalogue, data);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SERIES));
  const at = Math.min(Math.max(0, page), pages - 1);
  const unlocked = catalogue.entries.filter((entry) => data.unlocked.has(entry.id)).length;

  const text = [
    t("achievements-title", { unlocked, total: catalogue.entries.length }),
    t("achievements-page", { page: at + 1, pages }),
    "",
    ...all.slice(at * PAGE_SERIES, (at + 1) * PAGE_SERIES).flat(),
  ]
    .join("\n")
    .slice(0, MAX_MESSAGE_LENGTH);

  const nav = [
    ...(at > 0
      ? [
          InlineKeyboard.text(
            t("achievements-prev"),
            encodeProgressCallback({ type: "achievements", page: at - 1 }),
          ),
        ]
      : []),
    ...(at < pages - 1
      ? [
          InlineKeyboard.text(
            t("achievements-next"),
            encodeProgressCallback({ type: "achievements", page: at + 1 }),
          ),
        ]
      : []),
  ];
  const back = InlineKeyboard.text(
    t("achievements-back"),
    encodeProgressCallback({ type: "profile" }),
  );
  return { text, keyboard: InlineKeyboard.from(nav.length > 0 ? [nav, [back]] : [[back]]) };
}
