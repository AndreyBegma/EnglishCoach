import type { Db } from "../db/client";
import { countWordCardsByType } from "../db/repositories/cards";
import { findUnseenUnits, findUnseenWords } from "../db/repositories/words";
import { type CefrLevel, cefrLevelEnum, type LexicalUnitType, type Word } from "../db/schema";
import { IDIOM_MIN_LEVEL, type LexicalType } from "./lexical";

/** Share of a pick that may come from the level above the learner's. */
const LEVEL_UP_SHARE = 0.2;

/**
 * The mix is measured over this many of the learner's latest cards, so a learner with hundreds of
 * words from before units existed gets the mix from now on, not a long run of units to catch up.
 */
export const MIX_WINDOW = 20;

/**
 * The mix of new units per learner level, as shares of the learner's latest word-like cards. A
 * type missing from a level is never offered there: idioms only from B2.
 */
export const UNIT_SHARES: Record<CefrLevel, Partial<Record<LexicalUnitType, number>>> = {
  A1: { word: 0.85, collocation: 0.15 },
  A2: { word: 0.7, collocation: 0.15, phrasal_verb: 0.1, word_family: 0.05 },
  B1: { word: 0.6, collocation: 0.15, phrasal_verb: 0.15, word_family: 0.1 },
  B2: { word: 0.5, collocation: 0.15, phrasal_verb: 0.15, word_family: 0.1, idiom: 0.1 },
  C1: { word: 0.5, collocation: 0.1, phrasal_verb: 0.1, word_family: 0.15, idiom: 0.15 },
  C2: { word: 0.5, collocation: 0.1, phrasal_verb: 0.1, word_family: 0.15, idiom: 0.15 },
};

/** Tie-break order: the earlier type wins an equal deficit. */
const TYPE_ORDER: LexicalUnitType[] = [
  "word",
  "collocation",
  "phrasal_verb",
  "word_family",
  "idiom",
];

const LEVELS = cefrLevelEnum.enumValues;
const levelIndex = (level: CefrLevel) => LEVELS.indexOf(level);

function nextLevel(level: CefrLevel): CefrLevel | undefined {
  return LEVELS[levelIndex(level) + 1];
}

/** Whether a type may be offered at a learner level at all. */
export function offersType(level: CefrLevel, type: LexicalUnitType): boolean {
  if (type === "idiom" && levelIndex(level) < levelIndex(IDIOM_MIN_LEVEL)) return false;
  return (UNIT_SHARES[level][type] ?? 0) > 0;
}

/**
 * The levels a unit type is searched at, best first: the learner's, the one above, then the lower
 * ones nearest first (a C1 learner who never met a B1 phrasal verb still should). Idioms never
 * below B2, whatever the learner's level.
 */
export function unitLevels(level: CefrLevel, type: LexicalType): CefrLevel[] {
  const at = levelIndex(level);
  const order = [at, at + 1, ...Array.from({ length: at }, (_, i) => at - 1 - i)];
  return order
    .map((i) => LEVELS[i])
    .filter((value): value is CefrLevel => value !== undefined)
    .filter((value) => type !== "idiom" || levelIndex(value) >= levelIndex(IDIOM_MIN_LEVEL));
}

/**
 * The type of the next new unit: the one furthest below its share of the learner's cards once
 * this one is added, among the types still `available`. Undefined when none is.
 */
export function nextUnitType(
  level: CefrLevel,
  have: Partial<Record<LexicalUnitType, number>>,
  available: (type: LexicalUnitType) => boolean,
): LexicalUnitType | undefined {
  const total = TYPE_ORDER.reduce((sum, type) => sum + (have[type] ?? 0), 0) + 1;
  let best: LexicalUnitType | undefined;
  let bestDeficit = Number.NEGATIVE_INFINITY;
  for (const type of TYPE_ORDER) {
    if (!offersType(level, type) || !available(type)) continue;
    const deficit = (UNIT_SHARES[level][type] ?? 0) * total - (have[type] ?? 0);
    if (deficit > bestDeficit) {
      best = type;
      bestDeficit = deficit;
    }
  }
  return best;
}

/**
 * The types of the next `n` picks, given how many words are available (`words`) and how many
 * units of each type: each pick takes the largest deficit, then counts as a card of its type.
 */
export function planTypes(
  level: CefrLevel,
  n: number,
  have: Partial<Record<LexicalUnitType, number>>,
  supply: Partial<Record<LexicalUnitType, number>>,
): LexicalUnitType[] {
  const counts = { ...have };
  const left = { ...supply };
  const plan: LexicalUnitType[] = [];
  for (let i = 0; i < n; i++) {
    const type = nextUnitType(level, counts, (t) => (left[t] ?? 0) > 0);
    if (!type) break;
    plan.push(type);
    counts[type] = (counts[type] ?? 0) + 1;
    left[type] = (left[type] ?? 0) - 1;
  }
  return plan;
}

export class WordPicker {
  constructor(private readonly db: Db) {}

  /**
   * Picks `n` new units the user has no card for, mixed by `UNIT_SHARES`: the words among them at
   * most floor(0.2 × their count) from one level above, the rest at `level`, each tier by
   * frequency rank; units by `unitLevels`, each in list order. A type that runs dry leaves its
   * slots to the others, so fewer than `n` come back only when everything is exhausted. Same data
   * in, same units out.
   */
  async pickNew(userId: number, level: CefrLevel, n: number): Promise<Word[]> {
    return this.mixed(userId, level, n, (k) => this.pickWords(userId, level, k));
  }

  /**
   * The next `n` units Learn words will show, in order, if the learner takes them one at a time:
   * a single pick has no level-up share, so words are the learner's level until it runs dry, then
   * the level above. Prefetch enriches exactly these.
   */
  async upcoming(userId: number, level: CefrLevel, n: number): Promise<Word[]> {
    return this.mixed(userId, level, n, (k) => this.upcomingWords(userId, level, k));
  }

  private async mixed(
    userId: number,
    level: CefrLevel,
    n: number,
    wordsFor: (k: number) => Promise<Word[]>,
  ): Promise<Word[]> {
    if (n <= 0) return [];
    const have = await this.haveByType(userId);
    const pools = new Map<LexicalUnitType, Word[]>();
    for (const type of TYPE_ORDER) {
      if (type === "word" || !offersType(level, type)) continue;
      pools.set(type, await findUnseenUnits(this.db, userId, type, unitLevels(level, type), n));
    }
    const supply = (wordSupply: number) =>
      Object.fromEntries([
        ["word", wordSupply],
        ...[...pools].map(([type, pool]) => [type, pool.length]),
      ]) as Partial<Record<LexicalUnitType, number>>;

    // Plan with unlimited words, fetch that many, and re-plan if the words ran short.
    let plan = planTypes(level, n, have, supply(n));
    const wanted = plan.filter((type) => type === "word").length;
    const picked = await wordsFor(wanted);
    if (picked.length < wanted) plan = planTypes(level, n, have, supply(picked.length));

    const queues = new Map([...pools].map(([type, pool]) => [type, [...pool]]));
    queues.set("word", picked);
    return plan.flatMap((type) => queues.get(type)?.shift() ?? []);
  }

  /** The user's latest cards per unit type; own words count as words. */
  private async haveByType(userId: number): Promise<Partial<Record<LexicalUnitType, number>>> {
    const {
      user_word: own = 0,
      word = 0,
      ...units
    } = await countWordCardsByType(this.db, userId, MIX_WINDOW);
    return { ...units, word: word + own };
  }

  private async pickWords(userId: number, level: CefrLevel, n: number): Promise<Word[]> {
    if (n <= 0) return [];

    const upper = nextLevel(level);
    const upperQuota = upper ? Math.floor(n * LEVEL_UP_SHARE) : 0;

    const base = await findUnseenWords(this.db, userId, level, n - upperQuota);
    const missing = n - upperQuota - base.length;
    const up = upper ? await findUnseenWords(this.db, userId, upper, upperQuota + missing) : [];

    // The upper level ran short while the learner's own level may still have more.
    if (base.length + up.length < n && base.length === n - upperQuota) {
      return [...(await findUnseenWords(this.db, userId, level, n - up.length)), ...up];
    }
    return [...base, ...up];
  }

  private async upcomingWords(userId: number, level: CefrLevel, n: number): Promise<Word[]> {
    if (n <= 0) return [];
    const base = await findUnseenWords(this.db, userId, level, n);
    const upper = nextLevel(level);
    if (base.length >= n || !upper) return base;
    return [...base, ...(await findUnseenWords(this.db, userId, upper, n - base.length))];
  }
}
