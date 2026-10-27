import { type Api, GrammyError, InlineKeyboard, type MiddlewareFn } from "grammy";
import type { BotContext } from "../bot/context";
import { DEFAULT_LOCALE, type Locale, type Translator } from "../bot/i18n";
import { isIgnorableDeleteError } from "../bot/telegram-errors";
import type { Db } from "../db/client";
import { getDailyStats, isGoalMet, markGoalMet, mistakePatternsOn } from "../db/repositories/daily";
import { countDueCards } from "../db/repositories/hub";
import type { SessionKind } from "../db/repositories/sessions";
import {
  findUserByTelegramId,
  getSettings,
  getUserById,
  listAllowedUsers,
} from "../db/repositories/users";
import type { User, UserSettings } from "../db/schema";
import type { SettingsChanged, SettingsField } from "../events/settings-events";
import { awardGoalMet, awardStreakMilestones } from "../gamification/awards";
import { QUESTIONS_PER_SESSION, startSeededGrammar } from "../grammar";
import type { HubUser } from "../hub/hub-service";
import type { Logger } from "../log";
import { restoreStreak, streakDays } from "../progress/streak";
import { acceptAnswer } from "../sessions/answer";
import { offerToCancel } from "../sessions/handlers";
import type { SessionEnded, SessionManager, StartOutcome } from "../sessions/session-manager";
import type { SkillRunner } from "../skills";
import { encodeRoutineCallback, type RoutineCallback } from "./callbacks";
import { reserveNotification } from "./notify";
import type { RoutineJobs, RoutineStore } from "./ports";
import {
  localDate,
  localMinutes,
  type RoutineSlot,
  safeZone,
  slotDate,
  slotSchedules,
} from "./time";

const MINUTES_PER_DAY = 24 * 60;

/** The morning prompt can be put off this many times, an hour each. */
export const MAX_SNOOZES = 2;
export const SNOOZE_MS = 60 * 60_000;

/**
 * A set is the existing sessions run back to back (docs/ARCHITECTURE.md → Daily routine). The
 * evening set is seeded grammar, then review (see `startEvening`).
 */
export const MORNING_SET: readonly [SessionKind, ...SessionKind[]] = ["review", "vocab_new"];

/** Settings that move or switch the daily jobs. */
const SCHEDULE_FIELDS: ReadonlySet<SettingsField> = new Set<SettingsField>([
  "timezone",
  "morningTime",
  "eveningTime",
  "remindersEnabled",
  "cefrLevel",
]);

export interface RoutineDeps {
  api: Api;
  db: Db;
  i18n: Translator;
  log: Logger;
  skills: SkillRunner;
  sessions: SessionManager;
  jobs: RoutineJobs;
  store: RoutineStore;
  /** Admins are allowed through env, not through `users.is_allowed`. */
  adminIds: readonly number[];
  /** The clock; tests pin it. */
  now?: () => Date;
}

/** What a fired job did, for logs and tests. */
export type FireOutcome = "sent" | "skipped" | "blocked";

export interface FireRequest {
  userId: number;
  slot: RoutineSlot;
  /** Set on a snoozed re-send of the morning prompt: how many times it was put off. */
  snoozes?: number;
}

/** Telegram refuses messages to a user who blocked the bot (or deleted their account) with 403. */
export const isBlockedError = (error: unknown) =>
  error instanceof GrammyError && error.error_code === 403;

/**
 * The daily routine: keeps each learner's jobs in step with their settings, sends the morning and
 * evening plans and the evening reminder, starts a set from a prompt, and records the daily goal
 * when a session ends.
 */
export class Routine {
  /** Users whose jobs were reconciled by this process since their last block. */
  private readonly seen = new Set<number>();

  constructor(private readonly deps: RoutineDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private isAllowed(user: User): boolean {
    return user.isAllowed || this.deps.adminIds.includes(user.telegramId);
  }

  /**
   * Brings one user's daily jobs in line with their settings: scheduled for an allowed learner
   * with a level who has not blocked the bot, removed otherwise. Returns whether jobs exist now.
   */
  async reconcile(userId: number): Promise<boolean> {
    const { db, jobs, store } = this.deps;
    const [user, settings] = await Promise.all([getUserById(db, userId), getSettings(db, userId)]);
    if (!user || !settings?.cefrLevel || !this.isAllowed(user) || (await store.isBlocked(userId))) {
      await jobs.unschedule(userId);
      return false;
    }
    await jobs.schedule(userId, slotSchedules(settings));
    return true;
  }

  /** Reconciles every allowed user and admin; run at boot. A failing user does not stop the rest. */
  async reconcileAll(): Promise<void> {
    const { db, log } = this.deps;
    const users = new Map((await listAllowedUsers(db)).map((user) => [user.id, user]));
    for (const telegramId of this.deps.adminIds) {
      const admin = await findUserByTelegramId(db, telegramId);
      if (admin) users.set(admin.id, admin);
    }
    for (const userId of users.keys()) {
      await this.reconcile(userId).catch((error: unknown) => {
        log.warn("routine reconcile failed", { userId, error });
      });
    }
  }

  /** `settings.changed` listener: reschedules when a field the jobs depend on changed. */
  async onSettingsChanged(event: SettingsChanged): Promise<void> {
    if (event.changed.some((field) => SCHEDULE_FIELDS.has(field))) {
      await this.reconcile(event.userId);
    }
  }

  /**
   * Session-end listener: sets `goal_met` for the learner-local days the session touched (the day
   * it started and the day it ended — a session across midnight counts its answers to both). A day
   * whose goal this call met earns the goal and streak XP, once: the flag never flips back; a
   * streak milestone it reached pays its bonus. Then a double goal today restores yesterday's
   * break (`restoreStreak`), paying any milestone the restored run passes.
   */
  async onSessionEnded({ session, user }: SessionEnded): Promise<void> {
    const { db } = this.deps;
    const settings = await getSettings(db, user.id);
    if (!settings) return;
    const clock = { now: this.now(), timezone: settings.timezone };
    const dates = new Set([
      localDate(session.startedAt, settings.timezone),
      localDate(clock.now, settings.timezone),
    ]);
    for (const date of dates) {
      if (!(await markGoalMet(db, user.id, date, settings.wordsPerDay))) continue;
      const streak = await streakDays(db, user.id, clock);
      await awardGoalMet(db, user.id, { date, streak: streak.current });
      if (streak.since) {
        const run = { before: streak.current - 1, after: streak.current, since: streak.since };
        await awardStreakMilestones(db, user.id, run);
      }
    }
    try {
      const restored = await restoreStreak(db, user.id, {
        ...clock,
        wordsPerDay: settings.wordsPerDay,
      });
      if (restored) await awardStreakMilestones(db, user.id, restored);
    } catch (error) {
      this.deps.log.warn("streak restore failed", { userId: user.id, error });
    }
  }

  /**
   * Middleware after access: the first update of a user in this process lifts a block (they are
   * talking to the bot again) and makes sure their jobs exist. Never fails the update.
   */
  activity(): MiddlewareFn<BotContext> {
    return async (ctx, next) => {
      const userId = ctx.user.id;
      if (!this.seen.has(userId)) {
        this.seen.add(userId);
        try {
          await this.deps.store.setBlocked(userId, false);
          await this.reconcile(userId);
        } catch (error) {
          this.seen.delete(userId);
          this.deps.log.warn("routine activity reconcile failed", { userId, error });
        }
      }
      await next();
    };
  }

  /**
   * Handles a due job. Sends at most one unsolicited message per (user, slot, local day); sends
   * nothing to a user who is no longer allowed (and drops their jobs) or who blocked the bot. A
   * 403 from Telegram marks the user blocked and drops their jobs.
   */
  async fire({ userId, slot, snoozes = 0 }: FireRequest): Promise<FireOutcome> {
    const { db, jobs, store, log } = this.deps;
    const user = await getUserById(db, userId);
    if (!user || !this.isAllowed(user)) {
      await jobs.unschedule(userId);
      return "skipped";
    }
    if (await store.isBlocked(userId)) return "skipped";
    const settings = await getSettings(db, userId);
    if (!settings?.cefrLevel) return "skipped";

    const now = this.now();
    const date = slotDate(slot, now, settings.timezone);
    if (slot === "reminder") {
      if (!settings.remindersEnabled || (await isGoalMet(db, userId, date))) return "skipped";
      // Mid-session the learner is already at it.
      if (await this.deps.sessions.findActive(userId)) return "skipped";
    }
    // A snoozed re-send is one the learner asked for: no claim, and it does not count.
    const snoozed = snoozes > 0;
    if (!snoozed && !(await store.claimSlot(userId, slot, date))) return "skipped";
    const release = snoozed
      ? async () => {}
      : await reserveNotification(store, { userId, slot, now, timezone: settings.timezone });
    if (!release) {
      await store.releaseSlot(userId, slot, date);
      return "skipped";
    }

    try {
      await this.sendPrompt(user, settings, slot, date, snoozes);
      return "sent";
    } catch (error) {
      if (isBlockedError(error)) {
        await this.block(userId);
        return "blocked";
      }
      // Worth a retry (the job has attempts left): give the slot back so the retry may send.
      if (!snoozed) {
        await release();
        await store.releaseSlot(userId, slot, date);
      }
      log.warn("routine prompt not sent", { userId, slot, error });
      throw error;
    }
  }

  /** The user blocked the bot: no more jobs until they write again. */
  private async block(userId: number): Promise<void> {
    const { jobs, store, log } = this.deps;
    log.info("routine disabled: bot blocked by user", { userId });
    this.seen.delete(userId);
    await store.setBlocked(userId, true);
    await store.clearPrompt(userId);
    await jobs.unschedule(userId);
  }

  private async sendPrompt(
    user: User,
    settings: UserSettings,
    slot: RoutineSlot,
    date: string,
    snoozes: number,
  ): Promise<void> {
    const locale = settings.uiLang ?? DEFAULT_LOCALE;
    const text =
      slot === "reminder"
        ? await this.reminderText(user.id, locale, settings.timezone, date)
        : await this.planText(user, settings, slot, date);
    const keyboard = new InlineKeyboard();
    if (slot === "morning") {
      keyboard.text(
        this.t(locale, "routine-start-morning"),
        encodeRoutineCallback({ type: "start", set: "morning" }),
      );
      if (snoozes < MAX_SNOOZES) {
        keyboard
          .row()
          .text(this.t(locale, "routine-later"), encodeRoutineCallback({ type: "later" }));
      }
    } else {
      keyboard.text(
        this.t(locale, "routine-start-evening"),
        encodeRoutineCallback({ type: "start", set: "evening" }),
      );
    }

    await this.removePrompt(user);
    const message = await this.deps.api.sendMessage(user.telegramId, text, {
      reply_markup: keyboard,
    });
    await this.deps.store.setPrompt(user.id, { messageId: message.message_id, slot, snoozes });
  }

  /** The plan from the `routine-plan` skill; a template when the LLM cannot be used. */
  private async planText(
    user: User,
    settings: UserSettings,
    slot: "morning" | "evening",
    date: string,
  ): Promise<string> {
    const { db, log } = this.deps;
    const locale = settings.uiLang ?? DEFAULT_LOCALE;
    const evening = slot === "evening";
    const zone = safeZone(settings.timezone);
    const [due, stats, mistakes, streak] = await Promise.all([
      countDueCards(db, user.id, this.now()),
      getDailyStats(db, user.id, date),
      evening ? mistakePatternsOn(db, user.id, date, zone, QUESTIONS_PER_SESSION) : [],
      this.streak(user.id, zone),
    ]);
    const vars = {
      slot,
      due_reviews: due,
      new_words: evening ? 0 : Math.max(0, settings.wordsPerDay - (stats?.newWords ?? 0)),
      grammar_items: evening ? QUESTIONS_PER_SESSION : 0,
      mistakes_to_review: mistakes.length,
      streak_days: streak,
    };
    try {
      return (await this.deps.skills.runSkill(user.id, "routine-plan", vars)).data.text;
    } catch (error) {
      log.warn("routine plan skill failed, using the template", { userId: user.id, slot, error });
      return this.templatePlan(locale, vars);
    }
  }

  /** The plan without the LLM: a heading and one line per non-zero count. */
  private templatePlan(
    locale: Locale,
    vars: {
      slot: "morning" | "evening";
      due_reviews: number;
      new_words: number;
      grammar_items: number;
    },
  ): string {
    const lines = [
      vars.grammar_items && this.t(locale, "routine-plan-grammar", { count: vars.grammar_items }),
      vars.due_reviews && this.t(locale, "routine-plan-reviews", { count: vars.due_reviews }),
      vars.new_words && this.t(locale, "routine-plan-words", { count: vars.new_words }),
    ].filter((line): line is string => Boolean(line));
    const heading = this.t(locale, `routine-plan-${vars.slot}`);
    return [heading, ...(lines.length ? lines : [this.t(locale, "routine-plan-empty")])].join("\n");
  }

  /**
   * The evening nudge for the open goal of `date`: "your N-day streak burns in X h" while there is
   * a streak to lose, the restore offer while yesterday's break can still be undone, else the plain
   * reminder — also once `date` is over (a reminder past midnight) or the streak cannot be read.
   */
  private async reminderText(
    userId: number,
    locale: Locale,
    timezone: string,
    date: string,
  ): Promise<string> {
    const now = this.now();
    const zone = safeZone(timezone);
    if (localDate(now, zone) !== date) return this.t(locale, "routine-reminder");
    const hours = Math.max(1, Math.ceil((MINUTES_PER_DAY - localMinutes(now, zone)) / 60));
    try {
      const streak = await streakDays(this.deps.db, userId, { now, timezone: zone });
      if (streak.current > 0) {
        return this.t(locale, "routine-reminder-burning", { days: streak.current, hours });
      }
      if (streak.restore) {
        return this.t(locale, "routine-reminder-restore", { days: streak.restore.days, hours });
      }
    } catch (error) {
      this.deps.log.warn("streak lookup failed", { userId, error });
    }
    return this.t(locale, "routine-reminder");
  }

  /** Days in a row the goal was met; 0 when it cannot be read (the plan still goes out). */
  private async streak(userId: number, timezone: string): Promise<number> {
    try {
      return (await streakDays(this.deps.db, userId, { now: this.now(), timezone })).current;
    } catch (error) {
      this.deps.log.warn("streak lookup failed", { userId, error });
      return 0;
    }
  }

  /** Deletes the routine prompt in the chat, if there is one. */
  private async removePrompt(user: HubUser): Promise<void> {
    const { store } = this.deps;
    const prompt = await store.getPrompt(user.id);
    if (!prompt) return;
    await store.clearPrompt(user.id);
    await this.deletePrompt(user, prompt.messageId);
  }

  private async deletePrompt(user: HubUser, messageId: number): Promise<void> {
    const { api, log } = this.deps;
    await api.deleteMessage(user.telegramId, messageId).catch((error: unknown) => {
      if (!isIgnorableDeleteError(error)) {
        log.warn("routine prompt cleanup failed", { userId: user.id, error });
      }
    });
  }

  /** A button on a routine prompt. Only the current prompt's buttons act; older ones are stale. */
  async onCallback(ctx: BotContext, callback: RoutineCallback): Promise<void> {
    const { store, jobs, sessions } = this.deps;
    const prompt = await store.getPrompt(ctx.user.id);
    if (!prompt || prompt.messageId !== ctx.callbackQuery?.message?.message_id) {
      await ctx.answerCallbackQuery({ text: ctx.t("routine-outdated") });
      await ctx.deleteMessage().catch(() => {});
      return;
    }

    if (callback.type === "later") {
      if (prompt.slot !== "morning" || prompt.snoozes >= MAX_SNOOZES) {
        await ctx.answerCallbackQuery({ text: ctx.t("routine-outdated") });
        return;
      }
      await ctx.answerCallbackQuery({ text: ctx.t("routine-snoozed") });
      await this.removePrompt(ctx.user);
      await jobs.snooze(ctx.user.id, prompt.snoozes + 1, SNOOZE_MS);
      return;
    }

    // The prompt shows the choice and no buttons while the set starts (its first part may call
    // the model), and goes once the set is on screen.
    const lock = (task: () => Promise<void>) => sessions.withLock(`routine:${ctx.user.id}`, task);
    await acceptAnswer(ctx, { lock }, async () => {
      await store.clearPrompt(ctx.user.id);
      try {
        const outcome =
          callback.set === "evening"
            ? await this.startEvening(ctx)
            : await sessions.startSequence(ctx.user, MORNING_SET, ctx);
        if (!outcome.started) await offerToCancel(sessions, ctx, outcome.active, ctx.user);
      } finally {
        await this.deletePrompt(ctx.user, prompt.messageId);
      }
    });
  }

  /** Grammar seeded with today's mistake patterns (plain grammar without any), then review. */
  private async startEvening(ctx: BotContext): Promise<StartOutcome> {
    const { db, sessions } = this.deps;
    const zone = safeZone(ctx.settings.timezone);
    const patterns = await mistakePatternsOn(
      db,
      ctx.user.id,
      localDate(this.now(), zone),
      zone,
      QUESTIONS_PER_SESSION,
    );
    const outcome = await startSeededGrammar(sessions, ctx, patterns);
    if (outcome.started) await sessions.continueWith(outcome.handle.session.id, ["review"]);
    return outcome;
  }

  private t(locale: Locale, key: string, variables?: Record<string, string | number>): string {
    return this.deps.i18n.t(locale, key, variables);
  }
}
