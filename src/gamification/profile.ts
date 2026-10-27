import { eq, sql } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import { encodeCallback } from "../bot/callbacks";
import type { Locale, Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { spendableXp } from "../db/repositories/streak";
import { getUserXp } from "../db/repositories/xp";
import { dailyStats, type Skill, type UserSettings } from "../db/schema";
import { getLevels, SKILLS } from "../levels";
import { encodeProgressCallback } from "../progress/callbacks";
import { cardsBlock } from "../progress/queries";
import { MAX_MESSAGE_LENGTH } from "../progress/render";
import { type Streak, streakDays } from "../progress/streak";
import { FREEZE_PRICE_XP, MAX_FREEZES } from "../progress/streak-rules";
import { latestAchievements } from "./achievements/view";
import { type ProfileLevel, profileLevel } from "./xp";

export interface ProfileTotals {
  wordsLearned: number;
  reviews: number;
  grammarAnswered: number;
  /** Days the daily goal was met. */
  goalDays: number;
}

export interface ProfileData {
  xp: number;
  level: ProfileLevel;
  streak: Streak;
  /** XP left to spend on freezes (earned XP less what freezes took). */
  spendableXp: number;
  /** The overall CEFR level, "B1.6"; null until the learner has a level. */
  cefr: string | null;
  /** Every skill with a level, in course order; `practised` once it has graded items behind it. */
  skills: { skill: Skill; label: string; practised: boolean }[];
  /** The latest achievements, emoji and title in the learner's locale, newest first. */
  achievements: string[];
  totals: ProfileTotals;
}

/** The latest achievements the profile shows. */
export const PROFILE_ACHIEVEMENTS = 3;

async function totals(db: Db, userId: number, timezone: string, now: Date): Promise<ProfileTotals> {
  const [[row], cards] = await Promise.all([
    db
      .select({
        reviews: sql<number>`coalesce(sum(${dailyStats.reviews}), 0)`,
        grammarAnswered: sql<number>`coalesce(sum(${dailyStats.grammarAnswered}), 0)`,
        goalDays: sql<number>`count(*) filter (where ${dailyStats.goalMet})`,
      })
      .from(dailyStats)
      .where(eq(dailyStats.userId, userId)),
    cardsBlock(db, userId, timezone, now),
  ]);
  return {
    wordsLearned: cards.wordsLearned,
    reviews: Number(row?.reviews ?? 0),
    grammarAnswered: Number(row?.grammarAnswered ?? 0),
    goalDays: Number(row?.goalDays ?? 0),
  };
}

/** Everything the Profile screen shows. */
export async function loadProfile(
  db: Db,
  userId: number,
  settings: (Pick<UserSettings, "timezone"> & Partial<Pick<UserSettings, "uiLang">>) | undefined,
  now: Date = new Date(),
): Promise<ProfileData> {
  const timezone = settings?.timezone ?? "UTC";
  // The streak first: it settles the freeze row the spendable XP is read from.
  const streak = await streakDays(db, userId, { now, timezone });
  const [xp, levels, sums, achievements, spendable] = await Promise.all([
    getUserXp(db, userId),
    getLevels(db, userId),
    totals(db, userId, timezone, now),
    latestAchievements(db, userId, settings?.uiLang ?? "en", PROFILE_ACHIEVEMENTS),
    spendableXp(db, userId),
  ]);
  const total = xp?.total ?? 0;
  return {
    xp: total,
    level: profileLevel(total),
    streak,
    spendableXp: spendable,
    cefr: levels?.overall.label ?? null,
    skills: SKILLS.flatMap((skill) => {
      const level = levels?.skills[skill];
      return level ? [{ skill, label: level.label, practised: level.evidence > 0 }] : [];
    }),
    achievements,
    totals: sums,
  };
}

const BAR_CELLS = 10;
const MAX_TITLE_CHARS = 80;

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** A text progress bar: `into` of `needed`, in ten cells. */
export function xpBar(into: number, needed: number): string {
  const filled = needed > 0 ? Math.min(BAR_CELLS, Math.floor((into / needed) * BAR_CELLS)) : 0;
  return "▰".repeat(filled) + "▱".repeat(BAR_CELLS - filled);
}

export function renderProfile(
  i18n: Translator,
  locale: Locale,
  data: ProfileData,
): { text: string; keyboard: InlineKeyboard } {
  const t = (key: string, variables?: Record<string, string | number>) =>
    i18n.t(locale, key, variables);
  const { level, streak, totals: sums } = data;

  const lines = [
    t("profile-title"),
    "",
    t("profile-level", { level: level.level, xp: data.xp }),
    t("profile-xp-bar", {
      bar: xpBar(level.into, level.needed),
      into: level.into,
      needed: level.needed,
      next: level.level + 1,
    }),
    t("profile-streak", { current: streak.current, best: streak.best }),
    t("profile-freezes", { count: streak.freezes, max: MAX_FREEZES, xp: data.spendableXp }),
    "",
    data.cefr ? t("profile-cefr", { level: data.cefr }) : t("profile-cefr-unset"),
    ...data.skills.map(({ skill, label, practised }) =>
      t(practised ? "profile-skill" : "profile-skill-seeded", {
        skill: t(`progress-skill-${skill}`),
        level: label,
      }),
    ),
    "",
    t("profile-achievements-title"),
    ...(data.achievements.length > 0
      ? data.achievements
          .slice(0, PROFILE_ACHIEVEMENTS)
          .map((title) => t("profile-achievement", { title: clip(title, MAX_TITLE_CHARS) }))
      : [t("profile-achievements-none")]),
    "",
    t("profile-totals-title"),
    t("profile-totals", {
      words: sums.wordsLearned,
      reviews: sums.reviews,
      grammar: sums.grammarAnswered,
      days: sums.goalDays,
    }),
  ];

  const text = lines.join("\n").slice(0, MAX_MESSAGE_LENGTH);
  const achievements = InlineKeyboard.text(
    t("profile-achievements-btn"),
    encodeProgressCallback({ type: "achievements", page: 0 }),
  );
  const back = InlineKeyboard.text(
    t("hub-back"),
    encodeCallback({ type: "screen", screen: "main" }),
  );
  const rows = [[achievements], [back]];
  if (streak.freezes < MAX_FREEZES) {
    rows.splice(1, 0, [
      InlineKeyboard.text(
        t("profile-freeze-buy", { price: FREEZE_PRICE_XP }),
        encodeProgressCallback({ type: "freeze" }),
      ),
    ]);
  }
  return { text, keyboard: InlineKeyboard.from(rows) };
}
