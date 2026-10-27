import { cefrLevelEnum, skillEnum } from "../../db/schema";

// From the schema rather than `src/levels`: the level helpers award XP, so importing them here
// would close an import cycle that is read at module load.
const CEFR_LEVELS = cefrLevelEnum.enumValues;
export const SKILLS = skillEnum.enumValues;

/**
 * Every metric an achievement may name, and the domain event that moves it. Counters are stored per
 * learner in `achievement_progress`; a catalogue entry unlocks when its counter reaches its
 * threshold. `·band` and `·skill` stand for one metric per CEFR band (`a1`…`c2`) or skill.
 *
 * | Metric | Moved by |
 * |---|---|
 * | `words_learned` | `card.learned` |
 * | `reviews`, `reviews_perfect` | `card.rated` (a passing review; one rated Good or Easy) |
 * | `grammar_answers`, `grammar_correct`, `grammar_correct_·band` | `grammar.answered` |
 * | `grammar_run` | `grammar.answered`: the best run of correct answers in a row |
 * | `topics_mastered`, `topics_mastered_·band`, `topic_mastered.<id>` | `topic.mastered` |
 * | `day_streak`, `goal_days` | `xp.awarded` (`streak`, `daily_goal`) |
 * | `xp_total`, `profile_level` | `xp.awarded` |
 * | `skill_·skill` | any graded item: the skill's CEFR band index (A1 = 0 … C2 = 5) |
 * | `talk_turns` | `xp.awarded` (`talk_turn`) |
 * | `corrections_fixed` | `talk.correction_fixed` (not emitted yet) |
 * | `sessions_finished`, `sessions_·kind`, `perfect_sessions` | `session.ended` (finished) |
 * | `sessions_morning`, `sessions_night`, `sessions_deep_night`, `sessions_weekend` | `session.ended`, learner-local time |
 * | `season_sessions.<season>` | `session.ended` inside the season's dates |
 */

export const BANDS = CEFR_LEVELS.map((band) => band.toLowerCase());

/** Session kinds that count as sessions of their own. */
export const SESSION_KINDS = [
  "vocab_new",
  "review",
  "grammar",
  "talk",
  "placement",
  "routine_morning",
  "routine_evening",
] as const;

export const METRICS: ReadonlySet<string> = new Set([
  "words_learned",
  "reviews",
  "reviews_perfect",
  "grammar_answers",
  "grammar_correct",
  ...BANDS.map((band) => `grammar_correct_${band}`),
  "grammar_run",
  "topic_mastered",
  "topics_mastered",
  ...BANDS.map((band) => `topics_mastered_${band}`),
  "day_streak",
  "goal_days",
  "xp_total",
  "profile_level",
  ...SKILLS.map((skill) => `skill_${skill}`),
  "talk_turns",
  "corrections_fixed",
  "sessions_finished",
  ...SESSION_KINDS.map((kind) => `sessions_${kind}`),
  "perfect_sessions",
  "sessions_morning",
  "sessions_night",
  "sessions_deep_night",
  "sessions_weekend",
  "season_sessions",
]);

/**
 * Internal counters (never named by the catalogue): the current run of correct grammar answers,
 * and the graded items and misses of the session in progress.
 */
export const RUN = {
  grammar: "run:grammar",
  items: "run:items",
  misses: "run:misses",
} as const;

/** A session is perfect with at least this many graded items and no miss. */
export const PERFECT_SESSION_ITEMS = 5;

/** Learner-local hours: morning is [5, 9), night [22, 24) and [0, 2), deep night [2, 5). */
export const HOURS = {
  morning: [5, 9],
  night: [22, 2],
  deepNight: [2, 5],
} as const;
