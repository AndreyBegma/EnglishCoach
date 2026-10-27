import type { Db } from "../../db/client";
import {
  applyCounterUpdates,
  type CounterUpdate,
  getCounters,
  insertUnlocks,
} from "../../db/repositories/achievements";
import { getSettings } from "../../db/repositories/users";
import { type DomainEventMap, type DomainEvents, domainEvents } from "../../events/domain-events";
import { topicById } from "../../grammar/topics";
import { getLevels } from "../../levels";
import type { Logger } from "../../log";
import { safeZone } from "../../routine/time";
import { awardXp } from "../awards";
import { type XpAwarded, type XpEvents, xpEvents } from "../events";
import { type Achievement, achievementCatalogue, type Catalogue } from "./catalogue";
import { HOURS, PERFECT_SESSION_ITEMS, RUN, SESSION_KINDS, SKILLS } from "./metrics";

export interface AchievementDeps {
  db: Db;
  log: Logger;
  catalogue?: Catalogue;
}

/** The learner-local clock at an instant: hour 0-23, Saturday/Sunday, and `MM-DD`. */
export function localClock(
  at: Date,
  zone: string,
): { hour: number; weekend: boolean; day: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: safeZone(zone),
      hourCycle: "h23",
      hour: "2-digit",
      weekday: "short",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    hour: Number(parts.hour) % 24,
    weekend: parts.weekday === "Sat" || parts.weekday === "Sun",
    day: `${parts.month}-${parts.day}`,
  };
}

const inHours = (hour: number, [from, to]: readonly [number, number]) =>
  from < to ? hour >= from && hour < to : hour >= from || hour < to;

/** Whether `MM-DD` falls inside an inclusive window that may wrap the new year. */
export function inSeason(day: string, { from, to }: { from: string; to: string }): boolean {
  return from <= to ? day >= from && day <= to : day >= from || day <= to;
}

const add = (metric: string, by = 1): CounterUpdate => ({ metric, op: "add", by });
const max = (metric: string, value: number): CounterUpdate => ({ metric, op: "max", value });
const set = (metric: string, value: number): CounterUpdate => ({ metric, op: "set", value });

/**
 * The achievements evaluator. Domain events move the learner's counters; every entry whose counter
 * reached its threshold is unlocked in the same transaction (the `user_achievements` primary key
 * makes that idempotent), and only the unlocks this call inserted award their XP — once, after the
 * commit, so a replayed event or a concurrent one never pays twice. A failure is logged and never
 * fails the event's emitter.
 */
export class AchievementEngine {
  constructor(private readonly deps: AchievementDeps) {}

  private get catalogue(): Catalogue {
    return this.deps.catalogue ?? achievementCatalogue();
  }

  /** Subscribes to the buses; returns the function that unsubscribes. */
  start(xp: XpEvents = xpEvents, events: DomainEvents = domainEvents): () => void {
    const offs = [
      xp.on("xp.awarded", (event) => this.onXpAwarded(event)),
      events.on("grammar.answered", (event) => this.onGrammarAnswered(event)),
      events.on("card.rated", (event) => this.onCardRated(event)),
      events.on("card.learned", (event) => this.onCardLearned(event)),
      events.on("topic.mastered", (event) => this.onTopicMastered(event)),
      events.on("session.ended", (event) => this.onSessionEnded(event)),
      events.on("talk.correction_fixed", (event) => this.onCorrectionFixed(event)),
    ];
    return () => {
      for (const off of offs) off();
    };
  }

  /**
   * Applies counter updates and unlocks what they reached; returns the entries this call unlocked.
   */
  async record(
    userId: number,
    updates: readonly CounterUpdate[],
    at: Date = new Date(),
  ): Promise<Achievement[]> {
    if (updates.length === 0) return [];
    const { db, log } = this.deps;
    const catalogue = this.catalogue;
    const ids = await db.transaction(async (tx) => {
      const values = await applyCounterUpdates(tx, userId, updates, at);
      const reached = [...values].flatMap(([counter, value]) =>
        (catalogue.byCounter.get(counter) ?? [])
          .filter((entry) => entry.threshold <= value)
          .map((entry) => entry.id),
      );
      return insertUnlocks(tx, userId, reached, at);
    });
    const unlocked = ids.flatMap((id) => catalogue.byId.get(id) ?? []);
    for (const entry of unlocked) {
      try {
        await awardXp(
          db,
          userId,
          { source: "achievement", amount: entry.xpReward, meta: { achievementId: entry.id } },
          at,
        );
      } catch (error) {
        log.warn("achievement xp award failed", { userId, achievementId: entry.id, error });
      }
    }
    return unlocked;
  }

  /** The skills' CEFR band indexes, for skills with graded items behind them. */
  private async skillUpdates(userId: number): Promise<CounterUpdate[]> {
    const levels = await getLevels(this.deps.db, userId);
    return SKILLS.flatMap((skill) => {
      const level = levels?.skills[skill];
      if (!level || level.evidence <= 0) return [];
      const band = Math.min(5, Math.max(0, Math.floor(level.rating)));
      return band > 0 ? [max(`skill_${skill}`, band)] : [];
    });
  }

  /** Runs a handler, logging instead of throwing: achievements never fail what earned them. */
  private async guarded(userId: number, what: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.deps.log.warn("achievements update failed", { userId, what, error });
    }
  }

  onXpAwarded(event: XpAwarded): Promise<void> {
    return this.guarded(event.userId, "xp.awarded", async () => {
      const updates = [max("xp_total", event.total), max("profile_level", event.level)];
      switch (event.source) {
        case "daily_goal":
          updates.push(add("goal_days"), max("day_streak", 1));
          break;
        case "streak":
          if (typeof event.meta.streak === "number") {
            updates.push(max("day_streak", event.meta.streak));
          }
          break;
        case "talk_turn":
          updates.push(add("talk_turns"), ...(await this.skillUpdates(event.userId)));
          break;
        case "topic_mastered":
          // Until topic mastery emits `topic.mastered` itself; the topic counter is idempotent.
          if (typeof event.meta.topicId === "string") {
            await this.onTopicMastered({ userId: event.userId, topicId: event.meta.topicId });
          }
          break;
      }
      await this.record(event.userId, updates);
    });
  }

  onGrammarAnswered(event: DomainEventMap["grammar.answered"]): Promise<void> {
    return this.guarded(event.userId, "grammar.answered", async () => {
      const correct = event.verdict === "correct";
      const run = await applyCounterUpdates(
        this.deps.db,
        event.userId,
        [
          correct ? add(RUN.grammar) : set(RUN.grammar, 0),
          add(RUN.items),
          ...(correct ? [] : [add(RUN.misses)]),
        ],
        event.at,
      );
      const band = event.topicId ? topicById(event.topicId)?.band.toLowerCase() : undefined;
      await this.record(
        event.userId,
        [
          add("grammar_answers"),
          ...(correct ? [add("grammar_correct")] : []),
          ...(correct && band ? [add(`grammar_correct_${band}`)] : []),
          max("grammar_run", run.get(RUN.grammar) ?? 0),
          ...(await this.skillUpdates(event.userId)),
        ],
        event.at,
      );
    });
  }

  onCardRated(event: DomainEventMap["card.rated"]): Promise<void> {
    return this.guarded(event.userId, "card.rated", async () => {
      const passed = event.score > 0;
      await applyCounterUpdates(
        this.deps.db,
        event.userId,
        [add(RUN.items), ...(passed ? [] : [add(RUN.misses)])],
        event.at,
      );
      const review = passed && !event.learned;
      await this.record(
        event.userId,
        [
          ...(review ? [add("reviews")] : []),
          ...(review && event.score >= 1 ? [add("reviews_perfect")] : []),
          ...(await this.skillUpdates(event.userId)),
        ],
        event.at,
      );
    });
  }

  onCardLearned(event: DomainEventMap["card.learned"]): Promise<void> {
    return this.guarded(event.userId, "card.learned", async () => {
      await this.record(event.userId, [add("words_learned")], event.at);
    });
  }

  /**
   * A mastered topic sets its own counter (once, however often it is reported), then the totals
   * are recounted from the topic counters, so a repeated event never inflates them.
   */
  onTopicMastered(event: DomainEventMap["topic.mastered"]): Promise<void> {
    return this.guarded(event.userId, "topic.mastered", async () => {
      const topic = topicById(event.topicId);
      if (!topic) return;
      const at = event.at ?? new Date();
      await this.record(event.userId, [set(`topic_mastered.${topic.id}`, 1)], at);
      const counters = await getCounters(this.deps.db, event.userId);
      const bands = new Map<string, number>();
      let total = 0;
      for (const [counter, value] of counters) {
        if (!counter.startsWith("topic_mastered.") || value < 1) continue;
        const band = topicById(counter.slice("topic_mastered.".length))?.band.toLowerCase();
        if (!band) continue;
        total += 1;
        bands.set(band, (bands.get(band) ?? 0) + 1);
      }
      await this.record(
        event.userId,
        [
          max("topics_mastered", total),
          ...[...bands].map(([band, count]) => max(`topics_mastered_${band}`, count)),
        ],
        at,
      );
    });
  }

  /**
   * Any end closes the session's item run; a finished session counts by kind, by the learner's
   * local time and date, and as perfect with enough items and no miss.
   */
  onSessionEnded(event: DomainEventMap["session.ended"]): Promise<void> {
    return this.guarded(event.userId, "session.ended", async () => {
      const { db } = this.deps;
      const counters = await getCounters(db, event.userId);
      const items = counters.get(RUN.items) ?? 0;
      const misses = counters.get(RUN.misses) ?? 0;
      await applyCounterUpdates(
        db,
        event.userId,
        [set(RUN.items, 0), set(RUN.misses, 0)],
        event.at,
      );
      if (event.status !== "finished") return;

      const settings = await getSettings(db, event.userId);
      const clock = localClock(event.at, settings?.timezone ?? "UTC");
      const kinds: readonly string[] = SESSION_KINDS;
      const updates = [
        add("sessions_finished"),
        ...(kinds.includes(event.kind) ? [add(`sessions_${event.kind}`)] : []),
        ...(items >= PERFECT_SESSION_ITEMS && misses === 0 ? [add("perfect_sessions")] : []),
        ...(inHours(clock.hour, HOURS.morning) ? [add("sessions_morning")] : []),
        ...(inHours(clock.hour, HOURS.night) ? [add("sessions_night")] : []),
        ...(inHours(clock.hour, HOURS.deepNight) ? [add("sessions_deep_night")] : []),
        ...(clock.weekend ? [add("sessions_weekend")] : []),
        ...this.catalogue.seasons
          .filter((season) => inSeason(clock.day, season))
          .map((season) => add(`season_sessions.${season.id}`)),
      ];
      await this.record(event.userId, updates, event.at);
    });
  }

  onCorrectionFixed(event: DomainEventMap["talk.correction_fixed"]): Promise<void> {
    return this.guarded(event.userId, "talk.correction_fixed", async () => {
      await this.record(event.userId, [add("corrections_fixed")], event.at);
    });
  }
}
