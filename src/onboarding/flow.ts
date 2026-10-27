import type { BotContext } from "../bot/context";
import { DEFAULT_LOCALE, type Locale, type Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { getSettings, type SettingsPatch, updateSettings } from "../db/repositories/users";
import type { CefrLevel } from "../db/schema/enums";
import type { SettingsEvents, SettingsField } from "../events/settings-events";
import { answerOutdated } from "../hub/handlers";
import type { HubService } from "../hub/hub-service";
import { recordPlacement, seedLevels } from "../levels";
import type { Logger } from "../log";
import { acceptAnswer, tappedLabel } from "../sessions/answer";
import { offerToCancel } from "../sessions/handlers";
import type { LearningHandle, SessionManager } from "../sessions/session-manager";
import { INTEREST_SUGGESTIONS } from "../settings/options";
import {
  mergeInterests,
  parseInterests,
  parseProfession,
  toggleInterest,
} from "../settings/validate";
import { PLACEMENT_MAX_ITEMS, type SkillRunner } from "../skills";
import type { OnboardingCallback } from "./callbacks";
import { firstSentence, grade, nextStep, type PlacementStep } from "./placement";
import { OPTION_LETTERS, renderOnboarding } from "./screens";
import type { OnboardingMode, OnboardingState, OnboardingStep } from "./state";

export interface OnboardingDeps {
  db: Db;
  i18n: Translator;
  skills: SkillRunner;
  sessions: SessionManager;
  events: SettingsEvents;
  hub: HubService;
  log: Logger;
  /** Turns the freshly re-sent hub into Settings → AI provider. */
  openProviderSettings(ctx: BotContext): Promise<void>;
}

/**
 * Onboarding and the placement test. Both run inside one `placement` learning session, so every
 * message (the single card the steps edit in place, and the learner's own) is tracked and the
 * session manager's cleanup leaves only the hub. The same session, minus the welcome steps, is
 * what Settings → "Retake placement test" starts.
 */
export class OnboardingFlow {
  constructor(private readonly deps: OnboardingDeps) {}

  /**
   * The first-`/start` branch. Returns true when the command was handled here: a learner without
   * a level starts onboarding, or gets the current step again when it is already running.
   */
  async onStart(ctx: BotContext): Promise<boolean> {
    if (ctx.settings.cefrLevel !== null) return false;

    const learning = ctx.learning;
    if (learning) {
      if (learning.session.kind !== "placement") return false;
      const state = ctx.session.onboarding;
      if (state?.sessionId === learning.session.id) {
        await this.show(ctx, learning, state, { fresh: true });
      } else {
        await this.begin(ctx, learning, "onboarding");
      }
      return true;
    }

    const outcome = await this.deps.sessions.start(ctx.user, "placement");
    if (!outcome.started) return false;
    await this.begin(ctx, outcome.handle, "onboarding");
    return true;
  }

  /** Settings → "Retake placement test". */
  async retake(ctx: BotContext): Promise<void> {
    const outcome = await this.deps.sessions.start(ctx.user, "placement");
    if (!outcome.started) {
      await offerToCancel(this.deps.sessions, ctx, outcome.active, ctx.user);
      return;
    }
    await this.begin(ctx, outcome.handle, "retake");
  }

  async begin(ctx: BotContext, learning: LearningHandle, mode: OnboardingMode): Promise<void> {
    const state: OnboardingState = {
      sessionId: learning.session.id,
      mode,
      step: mode === "onboarding" ? "language" : "retake-intro",
      answers: [],
      wantsOwnProvider: false,
    };
    await this.show(ctx, learning, state, { fresh: true });
  }

  /** An onboarding button. Buttons of a dead card or an older session are answered and dropped. */
  async onCallback(ctx: BotContext, callback: OnboardingCallback): Promise<void> {
    const learning = ctx.learning;
    if (learning?.session.kind !== "placement") return answerOutdated(ctx, this.deps.hub);

    const state = ctx.session.onboarding;
    if (state?.sessionId !== learning.session.id) {
      // The flow state was lost (Redis flushed); start the session's flow over.
      await ctx.answerCallbackQuery();
      await this.begin(ctx, learning, ctx.settings.cefrLevel === null ? "onboarding" : "retake");
      return;
    }
    if (ctx.callbackQuery?.message?.message_id !== state.messageId) {
      await ctx.answerCallbackQuery({ text: ctx.t("hub-outdated") });
      return;
    }

    const on = (...steps: OnboardingStep[]) => steps.includes(state.step);
    // The buttons that call the placement skill answer the tap themselves, through acceptAnswer.
    const accept = (chosen: string, task: () => Promise<void>, current?: () => boolean) =>
      acceptAnswer(ctx, { lock: learning.withLock, chosen, current }, task).then(() => {});
    if (callback.type === "answer") {
      const letter = OPTION_LETTERS[callback.index] ?? "";
      const option = state.item?.options[callback.index];
      return accept(
        option === undefined ? letter : `${letter}) ${option}`,
        async () => {
          if (!state.item) return;
          state.answers.push(grade(state.item, callback.index));
          state.item = undefined;
          await this.advance(ctx, learning, state);
        },
        () => on("question") && state.item !== undefined && callback.seq === state.itemSeq,
      );
    }
    if (callback.type === "take-test") {
      return accept(
        ctx.t("onboarding-take-test"),
        async () => {
          state.answers = [];
          await this.advance(ctx, learning, state);
        },
        () => on("path", "retake-intro"),
      );
    }
    // The profile steps: toggles re-show the card; each step's values are saved when it is done.
    if (callback.type === "goal") {
      return accept(
        tappedLabel(ctx) ?? "",
        () => {
          const goals = state.goals ?? [];
          state.goals = goals.includes(callback.goal)
            ? goals.filter((goal) => goal !== callback.goal)
            : [...goals, callback.goal];
          return this.show(ctx, learning, state);
        },
        () => on("goals"),
      );
    }
    if (callback.type === "goals-done") {
      if (on("goals") && !state.goals?.length) {
        await ctx.answerCallbackQuery({ text: ctx.t("onboarding-goals-empty") });
        return;
      }
      return accept(
        ctx.t("onboarding-next"),
        async () => {
          await this.save(ctx, { goals: state.goals ?? [] }, ["goals"]);
          await this.goto(ctx, learning, state, "interests");
        },
        () => on("goals") && (state.goals?.length ?? 0) > 0,
      );
    }
    if (callback.type === "interest") {
      return accept(
        tappedLabel(ctx) ?? "",
        async () => {
          const id = INTEREST_SUGGESTIONS[callback.index] ?? "";
          state.interests = toggleInterest(state.interests ?? [], id);
          await this.show(ctx, learning, state);
        },
        () => on("interests"),
      );
    }
    if (callback.type === "interests-done") {
      return accept(
        tappedLabel(ctx) ?? "",
        async () => {
          await this.save(ctx, { interests: state.interests ?? [] }, ["interests"]);
          await this.goto(ctx, learning, state, "profession");
        },
        () => on("interests"),
      );
    }
    if (callback.type === "profession-skip") {
      return accept(
        ctx.t("onboarding-skip"),
        () => this.goto(ctx, learning, state, "provider"),
        () => on("profession"),
      );
    }
    if (callback.type === "retry") {
      return accept(
        ctx.t("onboarding-retry"),
        () => this.advance(ctx, learning, state),
        () => on("error"),
      );
    }

    await ctx.answerCallbackQuery();

    switch (callback.type) {
      case "lang":
        if (!on("language")) return;
        await this.save(ctx, { uiLang: callback.lang, explainLang: callback.lang }, [
          "uiLang",
          "explainLang",
        ]);
        return this.goto(ctx, learning, state, "goals");
      case "provider":
        if (!on("provider")) return;
        state.wantsOwnProvider = callback.choice === "own";
        return this.goto(ctx, learning, state, "path");
      case "know-level":
        if (!on("path", "error") || state.mode !== "onboarding") return;
        return this.goto(ctx, learning, state, "level");
      case "level": {
        if (!on("level")) return;
        await seedLevels(this.deps.db, ctx.user.id, callback.level, "chosen");
        await this.save(ctx, { cefrLevel: callback.level }, ["cefrLevel"]);
        state.summaryLine = this.deps.i18n.t(await this.locale(ctx), "onboarding-summary-chosen", {
          level: callback.level,
        });
        return this.goto(ctx, learning, state, "words");
      }
      case "continue":
        if (!on("result")) return;
        if (state.mode === "retake") return this.finish(ctx, learning, state);
        return this.goto(ctx, learning, state, "words");
      case "words":
        if (!on("words")) return;
        await this.save(ctx, { wordsPerDay: callback.count }, ["wordsPerDay"]);
        return this.goto(ctx, learning, state, "morning");
      case "morning":
        if (!on("morning")) return;
        await this.save(ctx, { morningTime: callback.time }, ["morningTime"]);
        return this.goto(ctx, learning, state, "evening");
      case "evening":
        if (!on("evening")) return;
        await this.save(ctx, { eveningTime: callback.time }, ["eveningTime"]);
        return this.finish(ctx, learning, state);
      case "cancel":
        if (!on("retake-intro", "error") || state.mode !== "retake") return;
        ctx.session.onboarding = undefined;
        await learning.end("cancelled");
        return;
    }
  }

  /**
   * A message typed during the session: interests and the profession are free text. The session
   * manager deletes the message afterwards; anything typed where a button is expected gets a note.
   */
  async onMessage(ctx: BotContext, learning: LearningHandle): Promise<void> {
    const state = ctx.session.onboarding;
    if (state?.sessionId !== learning.session.id) return;
    const t = this.deps.i18n;
    const locale = await this.locale(ctx);
    const text = ctx.message?.text ?? "";

    if (state.step === "interests") {
      const added = parseInterests(text);
      if (!added) return learning.window.flashNote(t.t(locale, "input-interests-invalid"));
      state.interests = mergeInterests(state.interests ?? [], added);
      return this.show(ctx, learning, state);
    }
    if (state.step === "profession") {
      const profession = parseProfession(text);
      if (!profession) return learning.window.flashNote(t.t(locale, "input-profession-invalid"));
      await this.save(ctx, { profession }, ["profession"]);
      return this.goto(ctx, learning, state, "provider");
    }
    await learning.window.flashNote(t.t(locale, "onboarding-use-buttons"));
  }

  /** Asks the skill for the next item, or the verdict, and moves to the matching step. */
  private async advance(
    ctx: BotContext,
    learning: LearningHandle,
    state: OnboardingState,
  ): Promise<void> {
    let step: PlacementStep;
    try {
      const { data } = await this.deps.skills.runSkill(ctx.user.id, "placement-test", {
        answers: state.answers,
        max_items: PLACEMENT_MAX_ITEMS,
      });
      step = nextStep(state.answers, data);
    } catch (error) {
      this.deps.log.warn("placement step failed", { userId: ctx.user.id, error });
      return this.goto(ctx, learning, state, "error");
    }

    if (step.kind === "item") {
      state.item = step.item;
      state.itemSeq = (state.itemSeq ?? 0) + 1;
      return this.goto(ctx, learning, state, "question");
    }

    await recordPlacement(this.deps.db, ctx.user.id, step.level, state.answers);
    // The cache now holds the model's band, which the graded items may have moved off the result.
    await this.deps.events.emit({ userId: ctx.user.id, changed: ["cefrLevel"] });
    state.result = { level: step.level, summary: step.summary };
    state.item = undefined;
    state.summaryLine = await this.testSummaryLine(ctx, state, step.level, step.summary);
    return this.goto(ctx, learning, state, "result");
  }

  private async testSummaryLine(
    ctx: BotContext,
    state: OnboardingState,
    level: CefrLevel,
    summary: string | null,
  ): Promise<string> {
    const t = this.deps.i18n;
    const locale = await this.locale(ctx);
    const correct = state.answers.filter((answer) => answer.correct).length;
    const detail = summary
      ? firstSentence(summary)
      : t.t(locale, "onboarding-result-fallback", { correct, total: state.answers.length });
    return t.t(locale, "onboarding-summary-test", { level, detail });
  }

  /** Ends the session: the manager deletes every tracked message and re-sends the hub. */
  private async finish(
    ctx: BotContext,
    learning: LearningHandle,
    state: OnboardingState,
  ): Promise<void> {
    ctx.session.onboarding = undefined;
    const line = state.summaryLine ?? this.deps.i18n.t(await this.locale(ctx), "onboarding-done");
    await learning.end("finished", { line });
    if (state.wantsOwnProvider) await this.deps.openProviderSettings(ctx);
  }

  private goto(
    ctx: BotContext,
    learning: LearningHandle,
    state: OnboardingState,
    step: OnboardingStep,
  ): Promise<void> {
    state.step = step;
    return this.show(ctx, learning, state);
  }

  /**
   * Renders the card in the session window: edited in place, or sent again at the bottom when
   * `fresh` (a repeated /start) or when it is gone.
   */
  private async show(
    ctx: BotContext,
    learning: LearningHandle,
    state: OnboardingState,
    options: { fresh?: boolean } = {},
  ): Promise<void> {
    const { text, keyboard } = renderOnboarding(this.deps.i18n, await this.locale(ctx), state);
    state.messageId = await learning.window.show({ text, reply_markup: keyboard }, options);
    ctx.session.onboarding = state;
  }

  private async save(ctx: BotContext, patch: SettingsPatch, changed: SettingsField[]) {
    await updateSettings(this.deps.db, ctx.user.id, patch);
    await this.deps.events.emit({ userId: ctx.user.id, changed });
  }

  /** Read fresh: the learner may have just switched language, and `ctx.settings` is per update. */
  private async locale(ctx: BotContext): Promise<Locale> {
    return (await getSettings(this.deps.db, ctx.user.id))?.uiLang ?? DEFAULT_LOCALE;
  }
}
