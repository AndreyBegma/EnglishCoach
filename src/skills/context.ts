import type { Db } from "../db/client";
import { listTopMistakes } from "../db/repositories/mistakes";
import { getSettings } from "../db/repositories/users";
import type { CefrLevel, Language, Mistake, UserSettings } from "../db/schema";
import { getOverallLevel } from "../levels";

/** Native languages the prompts have curated hints for. */
export type NativeLanguage = Exclude<Language, "en">;

export type WeakSpot = Pick<Mistake, "category" | "pattern" | "exampleWrong" | "exampleRight"> & {
  timesSeen: number;
};

/** What every skill knows about the learner. Built per call; nothing here is cached. */
export type LearnerContext = {
  /** Null until the placement test has run. */
  level: CefrLevel | null;
  explainLang: Language;
  uiLang: Language;
  nativeLang: NativeLanguage | null;
  /** Learner-written; travels only in the user message. */
  interests: string[];
  /** Derived from learner text; travels only in the user message. */
  weakSpots: WeakSpot[];
};

export const WEAK_SPOT_LIMIT = 5;

function asNative(lang: Language): NativeLanguage | null {
  return lang === "en" ? null : lang;
}

/**
 * There is no native-language setting: a learner who wants explanations (or failing that, the
 * UI) in Russian or Ukrainian is taken to be a native speaker of it. Otherwise unknown.
 */
export function nativeLanguageOf(settings: Pick<UserSettings, "explainLang" | "uiLang">) {
  return asNative(settings.explainLang) ?? asNative(settings.uiLang);
}

export function toWeakSpot(mistake: Mistake): WeakSpot {
  return {
    category: mistake.category,
    pattern: mistake.pattern,
    exampleWrong: mistake.exampleWrong,
    exampleRight: mistake.exampleRight,
    timesSeen: mistake.count,
  };
}

/** Loads a learner's context from their settings and top mistakes. */
export function learnerContextFromDb(db: Db) {
  return async (userId: number): Promise<LearnerContext> => {
    const [settings, mistakes, level] = await Promise.all([
      getSettings(db, userId),
      listTopMistakes(db, userId, WEAK_SPOT_LIMIT),
      getOverallLevel(db, userId),
    ]);
    if (!settings) throw new Error(`user ${userId} has no settings`);
    return {
      level: level?.band ?? null,
      explainLang: settings.explainLang,
      uiLang: settings.uiLang,
      nativeLang: nativeLanguageOf(settings),
      interests: settings.interests,
      weakSpots: mistakes.map(toWeakSpot),
    };
  };
}
