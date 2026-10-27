import type { Db } from "../db/client";
import { verifiedExamples } from "../db/repositories/examples";
import { getSettings } from "../db/repositories/users";
import {
  getWordEnrichment,
  listPrefetchLearners,
  ownerWordsWithoutEnrichment,
  saveWordEnrichments,
  uncachedWordIds,
} from "../db/repositories/word-enrichments";
import type {
  CardExample,
  CreditedExample,
  Language,
  Word,
  WordEnrichmentData,
} from "../db/schema";
import type { WordImages } from "../images";
import type { LlmProvider } from "../llm/types";
import type { Logger } from "../log";
import {
  ENRICH_BATCH_MAX,
  EXAMPLE_CHECK_MAX,
  type LearnerContext,
  nativeLanguageOf,
  type SkillOutput,
  type SkillRegistry,
  SkillRunner,
} from "../skills";
import { DEFAULT_LEVEL } from "../vocab/core";
import type { EnglishVariant } from "../voice/engines";
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
  /** Voices the prefetched words and their examples ahead of time; absent without TTS. */
  speech?: SpeechPrewarm;
}

/** The part of the TTS the prefetch uses. `prewarm` never rejects and paces itself. */
export interface SpeechPrewarm {
  prewarm(texts: readonly string[], variant: EnglishVariant): Promise<unknown>;
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

/** Examples on a card. */
const EXAMPLES = 2;

/**
 * The examples a card takes as given, in order of precedence: the owner's sentence, then
 * human-written Tatoeba sentences up to the card's two. The model writes only the rest.
 */
function givenExamples(word: Word, lang: Language, verified: readonly CreditedExample[]) {
  const owner = ownerFields(word, lang).example;
  const room = EXAMPLES - (owner ? 1 : 0);
  return { owner, verified: verified.filter((example) => example.en !== owner).slice(0, room) };
}

type Given = ReturnType<typeof givenExamples>;

/**
 * Builds the cache row from the model's card. The curated fields win: the model was told to keep
 * them, and the server makes sure it did. The model was told to copy the given examples first, so
 * what follows them in its list is its own: `written`, still to be checked.
 */
function mergeCard(word: Word, lang: Language, card: BatchCard, given: Given) {
  const owner = ownerFields(word, lang);
  const examples: CreditedExample[] = [];
  const [first] = card.examples;
  if (given.owner && first) examples.push({ en: given.owner, translation: first.translation });
  examples.push(...given.verified);
  const skip = (given.owner ? 1 : 0) + given.verified.length;
  const written = card.examples.slice(skip, skip + EXAMPLES - examples.length);
  const data: WordEnrichmentData = {
    translation: owner.translation ?? card.translation,
    ipa: owner.ipa ?? card.ipa,
    pos: word.pos || card.pos,
    examples,
    collocations: card.collocations,
    mnemonic: card.mnemonic,
    imageQuery: card.image_query,
    emoji: card.emoji,
  };
  return { data, written };
}

/**
 * A card's examples when the model wrote them all (the inline fallback): human-written sentences
 * first, the model's after, two in all.
 */
export function preferVerified(
  written: readonly CardExample[],
  verified: readonly CreditedExample[],
): CreditedExample[] {
  return [...verified, ...written].slice(0, EXAMPLES);
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
    const verified = await verifiedExamples(
      this.deps.db,
      batch.map((word) => word.id),
      lang,
    );
    const given = new Map(
      batch.map((word) => [word.id, givenExamples(word, lang, verified.get(word.id) ?? [])]),
    );
    const { data } = await this.runner(lang).runSkill(0, "vocab-enrich-batch", {
      words: batch.map((word) => ({
        id: word.id,
        lemma: word.lemma,
        pos: word.pos || null,
        word_level: word.cefrLevel,
        ...ownerFields(word, lang),
        given_examples: (given.get(word.id)?.verified ?? []).map(({ en, translation }) => ({
          en,
          translation,
        })),
      })),
    });
    const byId = new Map(data.cards.map((card) => [card.id, card]));
    const merged = batch.flatMap((word) => {
      const card = byId.get(word.id);
      const wordGiven = given.get(word.id);
      return card && wordGiven ? [{ word, ...mergeCard(word, lang, card, wordGiven) }] : [];
    });
    if (merged.length < batch.length) {
      this.deps.log.warn("word enrichment batch left words out", {
        lang,
        asked: batch.length,
        answered: merged.length,
      });
    }
    await this.checkWritten(merged, lang);
    return saveWordEnrichments(
      this.deps.db,
      merged.map(({ word, data }) => ({ wordId: word.id, lang, data })),
    );
  }

  /**
   * The validation pass: the model's own examples are checked by `example-check` (grammar, the
   * word in the card's sense, the translation) and appended to their card only when they pass.
   * A rejected example is dropped and logged as a metric; a card may then show one example.
   */
  private async checkWritten(
    cards: { word: Word; data: WordEnrichmentData; written: CardExample[] }[],
    lang: Language,
  ): Promise<void> {
    const items = cards.flatMap(({ word, data, written }) =>
      written.map((example) => ({ word, data, example })),
    );
    for (let start = 0; start < items.length; start += EXAMPLE_CHECK_MAX) {
      const slice = items.slice(start, start + EXAMPLE_CHECK_MAX);
      const { data } = await this.runner(lang).runSkill(0, "example-check", {
        items: slice.map(({ word, data: card, example }, index) => ({
          index,
          lemma: word.lemma,
          pos: card.pos || null,
          sense: card.translation,
          en: example.en,
          translation: example.translation,
        })),
      });
      const ok = new Set(data.results.filter((result) => result.ok).map((result) => result.index));
      slice.forEach(({ word, data: card, example }, index) => {
        if (ok.has(index)) {
          card.examples.push(example);
          return;
        }
        const problem = data.results.find((result) => result.index === index)?.problem ?? null;
        this.deps.log.info("model example rejected", {
          metric: "vocab.example.rejected",
          wordId: word.id,
          lang,
          problem,
        });
      });
    }
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
    await this.prewarmSpeech(upcoming, settings.explainLang, settings.englishVariant);
    return written;
  }

  /**
   * Queues the upcoming words and their first example sentences for voicing in the learner's
   * variant, so the first 🔊 tap is instant. Not awaited: the TTS uploads one note every few
   * seconds, and the job does not hold its worker slot for that.
   */
  private async prewarmSpeech(list: Word[], lang: Language, variant: EnglishVariant) {
    const { speech, db } = this.deps;
    if (!speech || list.length === 0) return;
    const texts: string[] = [];
    for (const word of list) {
      texts.push(word.lemma);
      const [example] = (await getWordEnrichment(db, word.id, lang))?.examples ?? [];
      if (example) texts.push(typeof example === "string" ? example : example.en);
    }
    void speech.prewarm(texts, variant);
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
