import type { BotContext } from "../bot/context";
import { DEFAULT_LOCALE, type Locale, type Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { getSettings, type SettingsPatch, updateSettings } from "../db/repositories/users";
import type { SettingsEvents, SettingsField } from "../events/settings-events";
import type { SyllabusTopic } from "../grammar/syllabus";
import { SYLLABUS } from "../grammar/topics";
import { answerOutdated } from "../hub/handlers";
import type { HubService } from "../hub/hub-service";
import { getOverallLevel } from "../levels";
import type { Logger } from "../log";
import { OPTION_LETTERS, resultSummary } from "../placement/screens";
import { PlacementTest, startTest, type TestState } from "../placement/test";
import type { TopicFlagWriter } from "../placement/topics";
import { acceptAnswer, tappedLabel, whileTyping } from "../sessions/answer";
import { offerToCancel } from "../sessions/handlers";
import type { LearningHandle, SessionManager } from "../sessions/session-manager";
import { INTEREST_SUGGESTIONS } from "../settings/options";
import {
  mergeInterests,
  parseInterests,
  parseProfession,
  toggleInterest,
} from "../settings/validate";
import type { SkillRunner } from "../skills";
import type { Tts } from "../voice/tts";
import type { OnboardingCallback } from "./callbacks";
import { renderOnboarding } from "./screens";
import type { OnboardingMode, OnboardingState, OnboardingStep } from "./state";

/** What the test needs of text-to-speech: whether it can voice, and the voice note itself. */
export type PlacementSpeech = Pick<Tts, "available" | "play">;

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
  /** The listening section's voice; a getter, because voice is built after onboarding. */
  speech?: () => PlacementSpeech | undefined;
  /** Where the test's syllabus topic flags go; absent until topic progress exists. */
  topicFlags?: TopicFlagWriter;
  /** The syllabus the grammar section samples; the grammar module's by default. */
  topics?: readonly SyllabusTopic[];
  /** Index picker for topics and words; tests pin it. */
  pick?: (count: number) => number;
}

/** A writing answer is 3–5 sentences; fewer words than this cannot show a level. */
export const MIN_WRITING_WORDS = 15;
/** A spoken answer shorter than this says nothing about speaking. */
export const MIN_SPEAKING_WORDS = 8;
/** Longer answers are cut before grading: the task asks for a few sentences. */
const MAX_ANSWER_CHARS = 1500;

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Onboarding and the full placement test. Both run inside one `placement` learning session, so
 * every message (the single card the steps edit in place, the listening clips, and the learner's
 * own) is tracked and the session manager's cleanup leaves only the hub. The same session, minus
 * the welcome steps, is what the locked hub and Settings → "Retake placement test" start. The
 * levels are written once, when the last section is done: a session that ends before that
 * leaves nothing, and the next one starts the test over (it is taken in one go).
 */
export class OnboardingFlow {
  private readonly test: PlacementTest;

  constructor(private readonly deps: OnboardingDeps) {
    this.test = new PlacementTest({
      db: deps.db,
      skills: deps.skills,
      log: deps.log,
      topics: deps.topics ?? SYLLABUS.topics,
      topicFlags: deps.topicFlags,
      pick: deps.pick,
    });
  }

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

  /**
   * Settings → "Retake placement test", and the locked hub's test button. A learner without a
   * level yet goes through onboarding (which skips the steps already saved).
   */
  async retake(ctx: BotContext): Promise<void> {
    const outcome = await this.deps.sessions.start(ctx.user, "placement");
    if (!outcome.started) {
      await offerToCancel(this.deps.sessions, ctx, outcome.active, ctx.user);
      return;
    }
    await this.begin(
      ctx,
      outcome.handle,
      ctx.settings.cefrLevel === null ? "onboarding" : "retake",
    );
  }

  /**
   * Starts the session's flow. Onboarding begins with the welcome steps, unless they were done
   * in an earlier session that ended before the test did: then it goes straight to the test.
   */
  async begin(ctx: BotContext, learning: LearningHandle, mode: OnboardingMode): Promise<void> {
    const settings = await getSettings(this.deps.db, ctx.user.id);
    const profileDone = (settings?.goals.length ?? 0) > 0;
    const state: OnboardingState = {
      sessionId: learning.session.id,
      mode,
      step: mode === "onboarding" && !profileDone ? "language" : "intro",
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
    // The buttons that move the test (or call a skill) answer the tap themselves, through
    // acceptAnswer.
    const accept = (chosen: string, task: () => Promise<void>, current?: () => boolean) =>
      acceptAnswer(ctx, { lock: learning.withLock, chosen, current }, task).then(() => {});
    if (callback.type === "answer") {
      const letter = OPTION_LETTERS[callback.index] ?? "";
      const test = state.test;
      const option = test?.item?.questions[test.question]?.options[callback.index];
      return accept(
        option === undefined ? letter : `${letter}) ${option}`,
        async () => {
          if (!test) return;
          this.test.answer(test, callback.index);
          await this.advance(ctx, learning, state);
        },
        () =>
          on("test") &&
          test?.item?.questions[test.question] !== undefined &&
          callback.seq === state.itemSeq,
      );
    }
    if (callback.type === "take-test") {
      return accept(
        ctx.t("onboarding-start-test"),
        async () => {
          state.test = startTest();
          await this.advance(ctx, learning, state);
        },
        () => on("intro"),
      );
    }
    if (callback.type === "skip-section") {
      return accept(
        ctx.t("placement-skip-section"),
        async () => {
          if (!state.test) return;
          this.test.skip(state.test);
          await this.advance(ctx, learning, state);
        },
        () => on("test") && skippable(state.test),
      );
    }
    if (callback.type === "voice-on") {
      return accept(
        ctx.t("placement-voice-on"),
        async () => {
          await this.save(ctx, { voiceEnabled: true }, ["voiceEnabled"]);
          await this.advance(ctx, learning, state);
        },
        () => on("test") && state.test?.needsVoice === true,
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
        return this.goto(ctx, learning, state, "intro");
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
        if (!on("intro", "error") || state.mode !== "retake") return;
        ctx.session.onboarding = undefined;
        await learning.end("cancelled");
        return;
    }
  }

  /**
   * A message typed (or spoken) during the session: interests, the profession, and the test's
   * writing and speaking answers are free text. The session manager deletes the message
   * afterwards; anything typed where a button is expected gets a note.
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
    const item = state.step === "test" ? state.test?.item : undefined;
    if (item?.task != null && state.test) {
      const test = state.test;
      // The voice middleware has turned a voice message into its transcript by now.
      const spoken = ctx.message?.voice !== undefined;
      if (item.section === "writing" && spoken) {
        return learning.window.flashNote(t.t(locale, "placement-writing-typed"));
      }
      if (item.section === "speaking" && !spoken) {
        return learning.window.flashNote(t.t(locale, "placement-speaking-voice"));
      }
      const min = item.section === "writing" ? MIN_WRITING_WORDS : MIN_SPEAKING_WORDS;
      if (wordCount(text) < min) {
        return learning.window.flashNote(t.t(locale, `placement-${item.section}-short`));
      }
      return whileTyping(ctx, async () => {
        try {
          await this.test.submit(ctx.user.id, test, text.slice(0, MAX_ANSWER_CHARS));
        } catch (error) {
          this.deps.log.warn("placement grading failed", { userId: ctx.user.id, error });
          return this.goto(ctx, learning, state, "error");
        }
        await this.advance(ctx, learning, state);
      });
    }
    await learning.window.flashNote(t.t(locale, "onboarding-use-buttons"));
  }

  /**
   * Prepares the test's next screen — the next question, task or voice question — or stores
   * the finished test and shows its result. A skill failure shows the retry step; the test's
   * progress so far stays, so a retry asks for the same item again.
   */
  private async advance(
    ctx: BotContext,
    learning: LearningHandle,
    state: OnboardingState,
  ): Promise<void> {
    const test = state.test;
    if (!test) return this.goto(ctx, learning, state, "intro");
    const userId = ctx.user.id;
    const settings = await getSettings(this.deps.db, userId);
    try {
      await this.test.prepare(userId, test, {
        enabled: settings?.voiceEnabled ?? false,
        canSpeak: async () => (await this.deps.speech?.()?.available(userId)) ?? false,
      });
    } catch (error) {
      this.deps.log.warn("placement step failed", { userId, error });
      return this.goto(ctx, learning, state, "error");
    }

    if (this.test.outcome(test)) return this.complete(ctx, learning, state, test);

    state.itemSeq = (state.itemSeq ?? 0) + 1;
    await this.goto(ctx, learning, state, "test");
    if (test.item?.section === "listening" && test.item.passage) {
      const played = await this.playClip(ctx, learning, test.item.passage);
      if (!played) {
        // No clip, no listening: the section is skipped rather than asked blind.
        this.test.skip(test);
        return this.advance(ctx, learning, state);
      }
    }
  }

  /** Sends the listening clip under the window, tied to the step. False when it could not. */
  private async playClip(
    ctx: BotContext,
    learning: LearningHandle,
    script: string,
  ): Promise<boolean> {
    const speech = this.deps.speech?.();
    const chatId = ctx.chat?.id;
    if (!speech || chatId === undefined) return false;
    try {
      const settings = await getSettings(this.deps.db, ctx.user.id);
      const message = await speech.play(
        ctx.api,
        chatId,
        script,
        settings?.englishVariant ?? "us",
        ctx.user.id,
      );
      await learning.track(message.message_id);
      return true;
    } catch (error) {
      this.deps.log.warn("placement clip failed", { userId: ctx.user.id, error });
      return false;
    }
  }

  /** Stores the finished test and shows its result, in the learner's explanation language. */
  private async complete(
    ctx: BotContext,
    learning: LearningHandle,
    state: OnboardingState,
    test: TestState,
  ): Promise<void> {
    const userId = ctx.user.id;
    const { results } = await this.test.finish(userId, test);
    await this.deps.events.emit({ userId, changed: ["cefrLevel"] });
    const overall = (await getOverallLevel(this.deps.db, userId))?.label ?? "";
    const settings = await getSettings(this.deps.db, userId);
    const explain = settings?.explainLang ?? DEFAULT_LOCALE;
    state.test = undefined;
    state.result = resultSummary(this.deps.i18n, explain, overall, results);
    state.summaryLine = this.deps.i18n.t(await this.locale(ctx), "placement-summary", {
      level: overall,
    });
    return this.goto(ctx, learning, state, "result");
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

/** Only the voice sections can be skipped: on their voice question, a clip, or the speaking task. */
function skippable(test: TestState | undefined): boolean {
  if (!test) return false;
  if (test.needsVoice) return true;
  const section = test.item?.section;
  return section === "listening" || section === "speaking";
}
