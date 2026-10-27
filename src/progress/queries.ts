import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { listTopMistakes } from "../db/repositories/mistakes";
import { dailyStats, type Mistake, type Skill, type UserSettings } from "../db/schema";
import { localDate } from "../grammar/stats";
import { getLevels, type Levels, SKILLS } from "../levels";
import { type Streak, streakDays } from "./streak";

/** Days in the activity sparkline. */
export const ACTIVITY_DAYS = 7;
export const WEAK_PREVIEW = 5;
export const WEAK_SCREEN_LIMIT = 10;

export interface TodayBlock {
  newWords: number;
  reviews: number;
  goalMet: boolean;
}

export interface CardsBlock {
  new: number;
  learning: number;
  review: number;
  dueToday: number;
  dueTomorrow: number;
  /** Word cards the learner has passed the first check on (not the ones still waiting in Learn). */
  wordsLearned: number;
  /** Words the learner marked "I know this 100%"; counted apart from the learned ones. */
  wordsKnown: number;
}

export interface GrammarBlock {
  answered7: number;
  correct7: number;
  answered30: number;
  correct30: number;
}

export interface LevelBlock {
  /** The overall level, "B1.6". */
  overall: string;
  /** Skills with graded items behind them, in course order. */
  skills: { skill: Skill; label: string }[];
}

export interface ProgressData {
  /** Null until the learner has a level. */
  level: LevelBlock | null;
  wordsPerDay: number;
  streak: Streak;
  today: TodayBlock;
  cards: CardsBlock;
  /** Activity (new words + reviews + grammar answers) for the last 7 local days, oldest first. */
  activity: number[];
  grammar: GrammarBlock;
  weak: Mistake[];
}

/** A valid IANA zone for SQL `AT TIME ZONE`; UTC when the stored one does not parse. */
function zoneOf(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

const num = (value: unknown) => Number(value ?? 0);

export async function todayBlock(db: Db, userId: number, today: string): Promise<TodayBlock> {
  const [row] = await db
    .select({
      newWords: dailyStats.newWords,
      reviews: dailyStats.reviews,
      goalMet: dailyStats.goalMet,
    })
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, today)));
  return row ?? { newWords: 0, reviews: 0, goalMet: false };
}

/**
 * Cards by FSRS state (0 New, 1 Learning and 3 Relearning, 2 Review), how many reviewable cards
 * are due by the end of the learner's local today and tomorrow (overdue ones count as today), and
 * the words learned. One pass over the user's cards.
 */
export async function cardsBlock(
  db: Db,
  userId: number,
  timeZone: string,
  now: Date,
): Promise<CardsBlock> {
  const zone = zoneOf(timeZone);
  const rows = await db.execute<Record<keyof CardsBlock, string>>(sql`
    with bounds as (
      select (date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${zone})
                + interval '1 day') at time zone ${zone} as end_today
    )
    select
      count(*) filter (where c.known_at is null and c.state = 0) as "new",
      count(*) filter (where c.known_at is null and c.state in (1, 3)) as learning,
      count(*) filter (where c.known_at is null and c.state = 2) as review,
      count(*) filter (where c.known_at is null and (c.item_type = 'grammar_pattern' or c.reps > 0)
                         and c.due < b.end_today) as "dueToday",
      count(*) filter (where c.known_at is null and (c.item_type = 'grammar_pattern' or c.reps > 0)
                         and c.due >= b.end_today
                         and c.due < b.end_today + interval '1 day') as "dueTomorrow",
      count(*) filter (where c.known_at is null and c.item_type in ('word', 'user_word') and c.reps > 0) as "wordsLearned",
      count(*) filter (where c.known_at is not null) as "wordsKnown"
    from cards c cross join bounds b
    where c.user_id = ${userId}`);
  const row = rows[0];
  return {
    new: num(row?.new),
    learning: num(row?.learning),
    review: num(row?.review),
    dueToday: num(row?.dueToday),
    dueTomorrow: num(row?.dueTomorrow),
    wordsLearned: num(row?.wordsLearned),
    wordsKnown: num(row?.wordsKnown),
  };
}

/** Activity per local day for the last `ACTIVITY_DAYS` days, oldest first, zero where no row. */
export async function activityBlock(db: Db, userId: number, today: string): Promise<number[]> {
  const rows = await db.execute<{ day: string; total: string }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
           coalesce(s.new_words + s.reviews + s.grammar_answered, 0) as total
    from generate_series(${today}::date - ${ACTIVITY_DAYS - 1}::int, ${today}::date, interval '1 day')
         as d(day)
    left join daily_stats s on s.user_id = ${userId} and s.date = d.day::date
    order by d.day`);
  return rows.map((row) => num(row.total));
}

export async function grammarBlock(db: Db, userId: number, today: string): Promise<GrammarBlock> {
  const [row] = await db
    .select({
      answered7: sql<number>`coalesce(sum(${dailyStats.grammarAnswered}) filter (where ${dailyStats.date} >= (${today}::date - 6)), 0)`,
      correct7: sql<number>`coalesce(sum(${dailyStats.grammarCorrect}) filter (where ${dailyStats.date} >= (${today}::date - 6)), 0)`,
      answered30: sql<number>`coalesce(sum(${dailyStats.grammarAnswered}), 0)`,
      correct30: sql<number>`coalesce(sum(${dailyStats.grammarCorrect}), 0)`,
    })
    .from(dailyStats)
    .where(
      and(
        eq(dailyStats.userId, userId),
        sql`${dailyStats.date} >= ${today}::date - 29`,
        lte(dailyStats.date, today),
      ),
    );
  return {
    answered7: num(row?.answered7),
    correct7: num(row?.correct7),
    answered30: num(row?.answered30),
    correct30: num(row?.correct30),
  };
}

function levelBlock(levels: Levels): LevelBlock {
  return {
    overall: levels.overall.label,
    skills: SKILLS.flatMap((skill) => {
      const level = levels.skills[skill];
      return level && level.evidence > 0 ? [{ skill, label: level.label }] : [];
    }),
  };
}

/** Everything the Progress screen shows, one query per block. */
export async function loadProgress(
  db: Db,
  userId: number,
  settings: Pick<UserSettings, "wordsPerDay" | "timezone"> | undefined,
  now: Date = new Date(),
): Promise<ProgressData> {
  const timezone = settings?.timezone ?? "UTC";
  const today = localDate(now, timezone);
  const [levels, streak, todayStats, cards, activity, grammar, weak] = await Promise.all([
    getLevels(db, userId),
    streakDays(db, userId, { now, timezone }),
    todayBlock(db, userId, today),
    cardsBlock(db, userId, timezone, now),
    activityBlock(db, userId, today),
    grammarBlock(db, userId, today),
    listTopMistakes(db, userId, WEAK_PREVIEW),
  ]);
  return {
    level: levels ? levelBlock(levels) : null,
    wordsPerDay: settings?.wordsPerDay ?? 0,
    streak,
    today: todayStats,
    cards,
    activity,
    grammar,
    weak,
  };
}

/** The weak spots sub-screen's list (also what "Practice these" is seeded with). */
export function loadWeakSpots(db: Db, userId: number): Promise<Mistake[]> {
  return listTopMistakes(db, userId, WEAK_SCREEN_LIMIT);
}
