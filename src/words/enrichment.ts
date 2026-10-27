import type { Db } from "../db/client";
import { getSettings } from "../db/repositories/users";
import {
  getWordEnrichment,
  listPrefetchLearners,
  ownerWordsWithoutEnrichment,
  saveWordEnrichments,
  uncachedWordIds,
} from "../db/repositories/word-enrichments";
import type { Language, Word, WordEnrichmentData } from "../db/schema";
import type { WordImages } from "../images";
import type { LlmProvider } from "../llm/types";
import type { Logger } from "../log";
import {
  ENRICH_BATCH_MAX,
  type LearnerContext,
  nativeLanguageOf,
  type SkillOutput,
  type SkillRegistry,
  SkillRunner,
} from "../skills";
import { DEFAULT_LEVEL } from "../vocab/core";
import { WordPicker } from "./picker";

export interface WordEnricherDeps {
  db: Db;
  registry: SkillRegistry;
  /** The server's provider (`SERVER_LLM_PROVIDER`): prefetch never spends a learner's own key. */
  provider: () => LlmProvider;
  log: Logger;
  /** Words per LLM call, at most `ENRICH_BATCH_MAX`. */
  batchSize?: number;
  /** How many days of new words to keep enriched ahead of each learner. */
  prefetchDays?: number;
  /** `ADMIN_TELEGRAM_IDS`: admins are learners too. */
  adminTelegramIds?: readonly number[];
  /** Pictures for the prefetched words; absent when no stock-photo key is set. */
  images?: WordImages;
}

const DEFAULT_BATCH = 10;
const DEFAULT_PREFETCH_DAYS = 3;

type BatchCard = SkillOutput<"vocab-enrich-batch">["cards"][number];

/** The curated list's fields for a word in `lang`: its translation is Russian only. */
function ownerFields(word: Word, lang: Language) {
  return {
    translation: lang === "ru" ? word.translationRu : null,
    ipa: word.ipa,
    example: word.example,
  };
}

/**
 * Builds the cache row from the model's card. The curated fields win: the model was told to keep
 * them, and the server makes sure it did.
 */
function mergeCard(word: Word, lang: Language, card: BatchCard): WordEnrichmentData {
  const owner = ownerFields(word, lang);
  const [first, second] = card.examples;
  const examples =
    owner.example && first ? [{ en: owner.example, translation: first.translation }] : [];
  return {
    translation: owner.translation ?? card.translation,
    ipa: owner.ipa ?? card.ipa,
    pos: word.pos || card.pos,
    examples: examples.length && second ? [...examples, second] : card.examples,
    collocations: card.collocations,
    mnemonic: card.mnemonic,
    imageQuery: card.image_query,
    emoji: card.emoji,
  };
}

/** The context of a shared card: a language, no learner. */
function sharedContext(lang: Language): LearnerContext {
  return {
    level: null,
    explainLang: lang,
    uiLang: lang,
    nativeLang: nativeLanguageOf({ explainLang: lang, uiLang: lang }),
    interests: [],
    weakSpots: [],
  };
}

/**
 * Fills the shared enrichment cache ahead of time, so Learn words never waits on the LLM: the next
 * days of each learner's words (prefetch) and, slowly, the rest of the owner's list (backfill).
 * The LLM is called only for words with no cached row in the language, several words per call.
 */
export class WordEnricher {
  private readonly picker: WordPicker;
  private readonly batchSize: number;
  private readonly runners = new Map<Language, SkillRunner>();

  constructor(private readonly deps: WordEnricherDeps) {
    this.picker = new WordPicker(deps.db);
    this.batchSize = Math.min(Math.max(deps.batchSize ?? DEFAULT_BATCH, 1), ENRICH_BATCH_MAX);
  }

  private runner(lang: Language): SkillRunner {
    let runner = this.runners.get(lang);
    if (!runner) {
      const context = sharedContext(lang);
      runner = new SkillRunner({
        registry: this.deps.registry,
        provider: async () => this.deps.provider(),
        learner: async () => context,
      });
      this.runners.set(lang, runner);
    }
    return runner;
  }

  /**
   * Enriches the words of `list` that have no cached row in `lang`; returns how many rows were
   * written. Provider errors propagate; what earlier batches wrote stays.
   */
  async enrich(list: Word[], lang: Language): Promise<number> {
    const missing = await uncachedWordIds(
      this.deps.db,
      list.map((word) => word.id),
      lang,
    );
    const todo = list.filter((word) => missing.has(word.id));
    let written = 0;
    for (let start = 0; start < todo.length; start += this.batchSize) {
      written += await this.enrichBatch(todo.slice(start, start + this.batchSize), lang);
    }
    return written;
  }

  private async enrichBatch(batch: Word[], lang: Language): Promise<number> {
    const { data } = await this.runner(lang).runSkill(0, "vocab-enrich-batch", {
      words: batch.map((word) => ({
        id: word.id,
        lemma: word.lemma,
        pos: word.pos || null,
        word_level: word.cefrLevel,
        ...ownerFields(word, lang),
      })),
    });
    const byId = new Map(data.cards.map((card) => [card.id, card]));
    const rows = batch.flatMap((word) => {
      const card = byId.get(word.id);
      return card ? [{ wordId: word.id, lang, data: mergeCard(word, lang, card) }] : [];
    });
    if (rows.length < batch.length) {
      this.deps.log.warn("word enrichment batch left words out", {
        lang,
        asked: batch.length,
        answered: rows.length,
      });
    }
    return saveWordEnrichments(this.deps.db, rows);
  }

  /** Keeps the next `prefetchDays × words_per_day` new words of one learner enriched. */
  async prefetchUser(userId: number): Promise<number> {
    const settings = await getSettings(this.deps.db, userId);
    if (!settings) return 0;
    const days = this.deps.prefetchDays ?? DEFAULT_PREFETCH_DAYS;
    const upcoming = await this.picker.upcoming(
      userId,
      settings.cefrLevel ?? DEFAULT_LEVEL,
      days * settings.wordsPerDay,
    );
    const written = await this.enrich(upcoming, settings.explainLang);
    await this.fetchImages(upcoming, settings.explainLang);
    return written;
  }

  /**
   * Fetches the pictures of upcoming words too (each once, ever), so a card does not wait on the
   * stock APIs either. Only for prefetch, not backfill: the APIs' hourly limits are small.
   */
  private async fetchImages(list: Word[], lang: Language): Promise<void> {
    const { images, db, log } = this.deps;
    if (!images) return;
    for (const word of list) {
      const query = (await getWordEnrichment(db, word.id, lang))?.imageQuery;
      if (!query) continue;
      try {
        await images.forWord(word.id, query);
      } catch (error) {
        log.warn("word image prefetch failed", { wordId: word.id, error });
      }
    }
  }

  private learners() {
    return listPrefetchLearners(this.deps.db, this.deps.adminTelegramIds);
  }

  /** Prefetch for every learner the bot serves; one learner's failure does not stop the rest. */
  async prefetchAll(): Promise<number> {
    let written = 0;
    for (const learner of await this.learners()) {
      try {
        written += await this.prefetchUser(learner.userId);
      } catch (error) {
        this.deps.log.warn("word prefetch failed", { userId: learner.userId, error });
      }
    }
    return written;
  }

  /**
   * Enriches up to `limit` more owner-list words, in curriculum order, for each language learners
   * use. Low rate by design: it runs on a schedule, one small slice at a time.
   */
  async backfill(limit: number): Promise<number> {
    const langs = new Set((await this.learners()).map((learner) => learner.explainLang));
    let written = 0;
    for (const lang of langs) {
      written += await this.enrich(
        await ownerWordsWithoutEnrichment(this.deps.db, lang, limit),
        lang,
      );
    }
    return written;
  }
}
