import { InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import type { BotContext } from "../bot/context";
import {
  createCard,
  findPendingCard,
  findWordCardByFront,
  getCard,
  markCardKnown,
  unmarkCardKnown,
} from "../db/repositories/cards";
import { verifiedExamples } from "../db/repositories/examples";
import { getWordEnrichment } from "../db/repositories/word-enrichments";
import type { CardBack, CardRow, Language, Word, WordEnrichmentData } from "../db/schema";
import type { WordImage } from "../images";
import type { LearningHandle, SessionKindHandler } from "../sessions/session-manager";
import type { SkillOutput } from "../skills";
import { preferVerified } from "../words/enrichment";
import { WordPicker } from "../words/picker";
import type { VocabCallback } from "./callbacks";
import { button, type Lead, type VocabCore } from "./core";
import { pronunciationFor } from "./pronunciation";
import { cardCaption, cardHtml, escapeHtml, HTML } from "./render";
import { speakRow } from "./speak";
import { readFlow, writeFlow } from "./state";
import { localDate, newWordsOn } from "./stats";

/** A learner's own word or phrase: letters, spaces, apostrophes and hyphens, up to 60 chars. */
const OWN_WORD = /^\p{L}[\p{L}\p{M}' -]{0,59}$/u;

export function backFromEnrichment(data: SkillOutput<"vocab-enrich">): CardBack {
  return {
    translation: data.translation,
    ipa: data.ipa,
    pos: data.pos,
    examples: data.examples,
    collocations: data.collocations,
    mnemonic: data.mnemonic,
    imageQuery: data.image_query,
    emoji: data.emoji,
  };
}

/** The card back a prefetched, shared enrichment gives a new card. */
export function backFromCache(data: WordEnrichmentData): CardBack {
  return {
    translation: data.translation,
    ipa: data.ipa,
    pos: data.pos,
    examples: data.examples,
    collocations: data.collocations,
    mnemonic: data.mnemonic,
    imageQuery: data.imageQuery,
    emoji: data.emoji ?? null,
  };
}

/**
 * Learn words (`vocab_new`): today's new words one card at a time — read the card, pass a quick
 * recognition check, and the card enters FSRS rated by the result. A card is enriched by the LLM
 * once, when it is created; if the learner leaves before the check, the next session shows the
 * same card from the stored enrichment.
 */
export class LearnFlow implements SessionKindHandler {
  private readonly picker: WordPicker;

  constructor(private readonly core: VocabCore) {
    this.picker = new WordPicker(core.deps.db);
  }

  async onStart(handle: LearningHandle, ctx?: BotContext): Promise<void> {
    if (!ctx) {
      // Flow state lives in the update's grammY session; without an update there is nowhere to keep it.
      this.core.deps.log.warn("learn words started outside an update", { userId: handle.user.id });
      await handle.end("cancelled");
      return;
    }
    await this.showNext(handle, ctx);
  }

  async onMessage(handle: LearningHandle, ctx: BotContext): Promise<void> {
    const t = this.core.t(handle);
    const step = readFlow(ctx, handle.session.id);
    if (step?.kind !== "add-word") {
      await handle.window.flashNote(t("vocab-use-buttons"));
      return;
    }
    const text = ctx.message?.text?.trim().replace(/\s+/g, " ") ?? "";
    if (!OWN_WORD.test(text)) {
      await handle.window.flashNote(t("vocab-add-word-invalid"));
      return;
    }
    await this.addOwnWord(handle, ctx, text);
  }

  /** Whether `callback` answers what this session is waiting for. */
  accepts(handle: LearningHandle, ctx: BotContext, callback: VocabCallback): boolean {
    const step = readFlow(ctx, handle.session.id);
    switch (callback.op) {
      case "got-it":
        return step?.kind === "card" && step.cardId === callback.cardId;
      case "know":
        return step?.kind === "card" && step.cardId === callback.cardId;
      case "next-image":
        return step?.kind === "card" && step.cardId === callback.cardId;
      case "unknow":
        // Idempotent and independent of the step; the button is only on the screen after "know".
        return true;
      case "choice":
        return step?.kind === "choice" && step.cardId === callback.cardId;
      case "add-word":
        return step?.kind === "card" || step?.kind === "idle";
      case "add-cancel":
        return step?.kind === "add-word";
      case "retry":
        return step?.kind === "failed";
      case "finish":
        return true;
      default:
        return false;
    }
  }

  async onCallback(handle: LearningHandle, ctx: BotContext, callback: VocabCallback) {
    const t = this.core.t(handle);
    const step = readFlow(ctx, handle.session.id);
    switch (callback.op) {
      case "got-it": {
        const card = await getCard(this.core.deps.db, handle.user.id, callback.cardId);
        if (card) await this.core.sendExercise(handle, ctx, card, "recognition");
        return;
      }
      case "know": {
        const { db } = this.core.deps;
        const card = await getCard(db, handle.user.id, callback.cardId);
        if (!card) return;
        // The daily counter only grows in `rate`, so a known word never uses up the limit.
        const known = await markCardKnown(db, handle.user.id, card.id, this.core.now());
        await this.showNext(
          handle,
          ctx,
          known
            ? {
                line: t("vocab-known", { word: escapeHtml(card.front) }),
                rows: [[button(t("vocab-known-undo"), { op: "unknow", cardId: card.id })]],
              }
            : undefined,
        );
        return;
      }
      case "unknow": {
        const { db } = this.core.deps;
        const card = await getCard(db, handle.user.id, callback.cardId);
        // The card is pending again (or back on its old schedule); the next pick shows it first.
        if (card && (await unmarkCardKnown(db, handle.user.id, card.id))) {
          await this.showNext(handle, ctx, {
            line: t("vocab-known-undone", { word: escapeHtml(card.front) }),
          });
        }
        return;
      }
      case "next-image":
        await this.nextImage(handle, ctx, callback.cardId);
        return;
      case "choice":
        if (step?.kind === "choice") await this.answer(handle, ctx, step, callback.index);
        return;
      case "add-word":
        await this.core.show(handle, t("vocab-add-word-prompt"), [
          [button(t("vocab-add-word-cancel"), { op: "add-cancel" })],
        ]);
        writeFlow(ctx, handle.session.id, { kind: "add-word" });
        return;
      case "add-cancel":
        await this.showNext(handle, ctx);
        return;
      case "retry":
        if (step?.kind === "failed" && step.retry === "exercise" && step.cardId) {
          const card = await getCard(this.core.deps.db, handle.user.id, step.cardId);
          if (card) await this.core.sendExercise(handle, ctx, card, "recognition");
        } else {
          await this.showNext(handle, ctx);
        }
        return;
      case "finish":
        await this.core.finish(handle, ctx, "vocab-summary-learn-empty");
        return;
    }
  }

  /** The quick check: right → Good, wrong → Again. The learner sees the result, then the next card. */
  private async answer(
    handle: LearningHandle,
    ctx: BotContext,
    step: { cardId: number; options: string[]; correctIndex: number },
    index: number,
  ) {
    const t = this.core.t(handle);
    const card = await getCard(this.core.deps.db, handle.user.id, step.cardId);
    if (!card) return;
    const correct = index === step.correctIndex;
    if (!(await this.core.rate(handle, card, correct ? "good" : "again", "newWords"))) return;
    const answer = escapeHtml(step.options[step.correctIndex] ?? "");
    await this.showNext(handle, ctx, {
      line: correct
        ? t("vocab-learn-right", { word: escapeHtml(card.front) })
        : t("vocab-learn-wrong", { word: escapeHtml(card.front), answer }),
    });
  }

  /**
   * Shows the next card: a pending one first, else a new word — or says today's quota is done.
   * `lead` is the previous step's result, the first line of whatever comes next.
   */
  private async showNext(handle: LearningHandle, ctx: BotContext, lead?: Lead): Promise<void> {
    const { db } = this.core.deps;
    const t = this.core.t(handle);
    const settings = await this.core.settings(handle.user.id);
    const today = localDate(this.core.now(), settings.timezone);
    const learned = await newWordsOn(db, handle.user.id, today);

    if (learned >= settings.wordsPerDay) {
      await this.sendIdle(handle, ctx, t("vocab-learn-done", { count: learned }), lead);
      return;
    }

    const pending = await findPendingCard(db, handle.user.id);
    if (pending) {
      await this.showCard(handle, ctx, pending, lead);
      return;
    }

    const [word] = await this.picker.pickNew(handle.user.id, settings.level, 1);
    if (!word) {
      await this.sendIdle(handle, ctx, t("vocab-learn-no-words"), lead);
      return;
    }
    const back = await this.backFor(handle, ctx, word, settings.explainLang, lead);
    if (!back) return;
    const card = await createCard(db, {
      userId: handle.user.id,
      itemType: word.unitType,
      wordId: word.id,
      front: word.lemma,
      back: word.details ? { ...back, unit: word.details } : back,
      fsrs: this.core.scheduler.newCard(this.core.now()),
    });
    await this.showCard(handle, ctx, card, lead);
  }

  /**
   * The new card's back: from the shared cache the prefetch job fills, else enriched inline, with
   * human-written examples in front of the model's. A miss is logged as a metric — it should stay
   * near zero. Undefined when the inline call failed.
   */
  private async backFor(
    handle: LearningHandle,
    ctx: BotContext,
    word: Word,
    lang: Language,
    lead?: Lead,
  ): Promise<CardBack | undefined> {
    const cached = await getWordEnrichment(this.core.deps.db, word.id, lang);
    if (cached) return backFromCache(cached);
    this.core.deps.log.info("vocab enrichment cache miss", {
      metric: "vocab.enrich.cache_miss",
      userId: handle.user.id,
      wordId: word.id,
      lang,
    });
    const enriched = await this.core.llm(
      handle,
      ctx,
      { retry: "next" },
      () =>
        this.core.deps.skills.runSkill(handle.user.id, "vocab-enrich", {
          lemma: word.lemma,
          pos: word.pos || null,
          word_level: word.cefrLevel,
        }),
      lead,
    );
    if (!enriched) return undefined;
    const verified = await verifiedExamples(this.core.deps.db, [word.id], lang);
    const back = backFromEnrichment(enriched.data);
    return {
      ...back,
      examples: preferVerified(enriched.data.examples, verified.get(word.id) ?? []),
    };
  }

  private async addOwnWord(handle: LearningHandle, ctx: BotContext, text: string) {
    const { db } = this.core.deps;
    const t = this.core.t(handle);
    const existing = await findWordCardByFront(db, handle.user.id, text);
    if (existing) {
      const lead = { line: t("vocab-add-word-exists", { word: escapeHtml(existing.front) }) };
      if (existing.reps === 0 && !existing.knownAt)
        await this.showCard(handle, ctx, existing, lead);
      else await this.showNext(handle, ctx, lead);
      return;
    }
    const enriched = await this.core.llm(handle, ctx, { retry: "next" }, () =>
      this.core.deps.skills.runSkill(handle.user.id, "vocab-enrich", {
        lemma: text,
        pos: null,
        word_level: null,
      }),
    );
    if (!enriched) return;
    const card = await createCard(db, {
      userId: handle.user.id,
      itemType: "user_word",
      front: enriched.data.lemma,
      back: backFromEnrichment(enriched.data),
      fsrs: this.core.scheduler.newCard(this.core.now()),
    });
    await this.showCard(handle, ctx, card);
  }

  /**
   * "Another picture": the word's next picture replaces the photo in place. With none left, the
   * card comes back as it was (the answer lock took its buttons) under a note.
   */
  private async nextImage(handle: LearningHandle, ctx: BotContext, cardId: number) {
    const { db, images, log } = this.core.deps;
    const card = await getCard(db, handle.user.id, cardId);
    const query = card?.backJson.imageQuery;
    if (!card?.wordId || !query || !images) return;
    const image = await images.next(card.wordId, query).catch((error: unknown) => {
      log.warn("next word image failed", { wordId: card.wordId, error });
      return undefined;
    });
    await this.showCard(handle, ctx, card);
    if (!image) await handle.window.flashNote(this.core.t(handle)("vocab-image-none"));
  }

  /** The stored or freshly fetched picture of a dictionary word; undefined on any failure. */
  private async imageFor(card: CardRow): Promise<WordImage | undefined> {
    const { images, log } = this.core.deps;
    const query = card.backJson.imageQuery;
    if (!images || !card.wordId || !query) return undefined;
    try {
      return await images.forWord(card.wordId, query);
    } catch (error) {
      log.warn("word image failed", { wordId: card.wordId, error });
      return undefined;
    }
  }

  /**
   * A new word's card: one photo with the card as its caption when the word has a picture, else
   * the text card. A photo Telegram refuses falls back to the text card too.
   */
  private async showCard(handle: LearningHandle, ctx: BotContext, card: CardRow, lead?: Lead) {
    const t = this.core.t(handle);
    const image = await this.imageFor(card);
    const view = {
      ...card,
      pronunciation: await pronunciationFor(this.core.deps.db, card, ctx.settings.englishVariant),
    };
    const caption = image && cardCaption(t, view, image, lead?.line);
    const speak = await speakRow(t, ctx, card, this.core.deps.speech);
    const rows = (photo: boolean) => [
      [
        button(t("vocab-got-it"), { op: "got-it", cardId: card.id }),
        button(t("vocab-know"), { op: "know", cardId: card.id }),
      ],
      ...(photo ? [[button(t("vocab-image-next"), { op: "next-image", cardId: card.id })]] : []),
      [button(t("vocab-add-word"), { op: "add-word" })],
      ...speak,
      [button(t("vocab-finish"), { op: "finish" })],
    ];
    const shown =
      image &&
      caption &&
      (await this.showPhoto(handle, image, caption, [...(lead?.rows ?? []), ...rows(true)]));
    if (!shown) await this.core.show(handle, cardHtml(t, view), rows(false), lead);
    writeFlow(ctx, handle.session.id, { kind: "card", cardId: card.id });
  }

  /** False when Telegram would not take the photo (a URL it cannot fetch, for one). */
  private async showPhoto(
    handle: LearningHandle,
    image: WordImage,
    caption: string,
    keyboard: InlineKeyboardButton[][],
  ): Promise<boolean> {
    try {
      await handle.window.show({
        photo: image.url,
        caption,
        ...HTML,
        reply_markup: InlineKeyboard.from(keyboard),
      });
      return true;
    } catch (error) {
      this.core.deps.log.warn("word image not shown", { wordId: image.wordId, error });
      return false;
    }
  }

  private async sendIdle(handle: LearningHandle, ctx: BotContext, text: string, lead?: Lead) {
    const t = this.core.t(handle);
    await this.core.show(
      handle,
      text,
      [
        [
          button(t("vocab-add-word"), { op: "add-word" }),
          button(t("vocab-finish"), { op: "finish" }),
        ],
      ],
      lead,
    );
    writeFlow(ctx, handle.session.id, { kind: "idle" });
  }
}
