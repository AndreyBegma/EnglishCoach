import { InlineKeyboard } from "grammy";
import type { BotContext } from "../bot/context";
import {
  createCard,
  findPendingCard,
  findWordCardByFront,
  getCard,
} from "../db/repositories/cards";
import type { CardBack, CardRow } from "../db/schema";
import type { LearningHandle, SessionKindHandler } from "../sessions/session-manager";
import type { SkillOutput } from "../skills";
import { WordPicker } from "../words/picker";
import type { VocabCallback } from "./callbacks";
import { button, type VocabCore } from "./core";
import { cardHtml, escapeHtml, HTML } from "./render";
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
      await handle.send(t("vocab-use-buttons"));
      return;
    }
    const text = ctx.message?.text?.trim().replace(/\s+/g, " ") ?? "";
    if (!OWN_WORD.test(text)) {
      await handle.send(t("vocab-add-word-invalid"));
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
      case "choice":
        if (step?.kind === "choice") await this.answer(handle, ctx, step, callback.index);
        return;
      case "add-word":
        await handle.send(t("vocab-add-word-prompt"), {
          reply_markup: InlineKeyboard.from([
            [button(t("vocab-add-word-cancel"), { op: "add-cancel" })],
          ]),
        });
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
    await handle.send(
      correct
        ? t("vocab-learn-right", { word: escapeHtml(card.front) })
        : t("vocab-learn-wrong", { word: escapeHtml(card.front), answer }),
      HTML,
    );
    await this.showNext(handle, ctx);
  }

  /** Shows the next card: a pending one first, else a new word — or says today's quota is done. */
  private async showNext(handle: LearningHandle, ctx: BotContext): Promise<void> {
    const { db } = this.core.deps;
    const t = this.core.t(handle);
    const settings = await this.core.settings(handle.user.id);
    const today = localDate(this.core.now(), settings.timezone);
    const learned = await newWordsOn(db, handle.user.id, today);

    if (learned >= settings.wordsPerDay) {
      await this.sendIdle(handle, ctx, t("vocab-learn-done", { count: learned }));
      return;
    }

    const pending = await findPendingCard(db, handle.user.id);
    if (pending) {
      await this.showCard(handle, ctx, pending);
      return;
    }

    const [word] = await this.picker.pickNew(handle.user.id, settings.level, 1);
    if (!word) {
      await this.sendIdle(handle, ctx, t("vocab-learn-no-words"));
      return;
    }
    const enriched = await this.core.llm(handle, ctx, { retry: "next" }, () =>
      this.core.deps.skills.runSkill(handle.user.id, "vocab-enrich", {
        lemma: word.lemma,
        pos: word.pos,
        word_level: word.cefrLevel,
      }),
    );
    if (!enriched) return;
    const card = await createCard(db, {
      userId: handle.user.id,
      itemType: "word",
      wordId: word.id,
      front: word.lemma,
      back: backFromEnrichment(enriched.data),
      fsrs: this.core.scheduler.newCard(this.core.now()),
    });
    await this.showCard(handle, ctx, card);
  }

  private async addOwnWord(handle: LearningHandle, ctx: BotContext, text: string) {
    const { db } = this.core.deps;
    const t = this.core.t(handle);
    const existing = await findWordCardByFront(db, handle.user.id, text);
    if (existing) {
      await handle.send(t("vocab-add-word-exists", { word: escapeHtml(existing.front) }), HTML);
      if (existing.reps === 0) await this.showCard(handle, ctx, existing);
      else await this.showNext(handle, ctx);
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

  private async showCard(handle: LearningHandle, ctx: BotContext, card: CardRow) {
    const t = this.core.t(handle);
    await handle.send(cardHtml(t, card), {
      ...HTML,
      reply_markup: InlineKeyboard.from([
        [
          button(t("vocab-got-it"), { op: "got-it", cardId: card.id }),
          button(t("vocab-add-word"), { op: "add-word" }),
        ],
        [button(t("vocab-finish"), { op: "finish" })],
      ]),
    });
    writeFlow(ctx, handle.session.id, { kind: "card", cardId: card.id });
  }

  private async sendIdle(handle: LearningHandle, ctx: BotContext, text: string) {
    const t = this.core.t(handle);
    await handle.send(text, {
      reply_markup: InlineKeyboard.from([
        [
          button(t("vocab-add-word"), { op: "add-word" }),
          button(t("vocab-finish"), { op: "finish" }),
        ],
      ]),
    });
    writeFlow(ctx, handle.session.id, { kind: "idle" });
  }
}
