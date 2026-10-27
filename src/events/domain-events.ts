import type { EndedStatus, SessionKind } from "../db/repositories/sessions";
import { createLogger, type Logger } from "../log";

/**
 * Domain events: what happened to a learner, for modules that react to it (achievements) without
 * being called by the module where it happened. Each payload carries the learner; `at` is when it
 * happened, so a replay is judged by the original moment.
 *
 * | Event | Emitted by |
 * |---|---|
 * | `session.ended` | the bot wiring, from `SessionManager.onEnded` |
 * | `grammar.answered` | `awardGrammarItem` (`src/gamification/awards.ts`), every graded answer |
 * | `card.rated` | `awardCardRating`, every rating, Again included |
 * | `card.learned` | `awardCardRating`, once per card: the rating that met the active-mastery rule (`src/vocab/mastery.ts`) |
 * | `talk.correction_fixed` | not emitted yet: the Talk card that tracks a fixed correction |
 *
 * `xp.awarded` and `topic.mastered` keep their own buses (`src/gamification/events.ts`,
 * `src/grammar/events.ts`).
 */
export interface DomainEventMap {
  "session.ended": {
    userId: number;
    sessionId: number;
    kind: SessionKind;
    status: EndedStatus;
    startedAt: Date;
    at: Date;
  };
  "grammar.answered": {
    userId: number;
    topicId: string | null;
    verdict: string;
    score: number;
    at: Date;
  };
  /** `learned`: the rating that learns the card (see `card.learned`), not a review. */
  "card.rated": { userId: number; cardId: number; score: number; learned: boolean; at: Date };
  "card.learned": { userId: number; cardId: number; at: Date };
  "talk.correction_fixed": { userId: number; at?: Date };
}

export type DomainEventName = keyof DomainEventMap;
export type DomainListener<E extends DomainEventName> = (
  event: DomainEventMap[E],
) => void | Promise<void>;

/**
 * A typed bus with the `settings.changed` contract: listeners run in order, and a failing listener
 * is logged and never fails the emitter, nor the other listeners.
 */
export class DomainEvents {
  private readonly listeners = new Map<DomainEventName, Set<DomainListener<never>>>();

  constructor(private readonly log: Logger) {}

  /** Subscribes to one event by name; returns the unsubscribe function. */
  on<E extends DomainEventName>(event: E, listener: DomainListener<E>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    this.listeners.set(event, set);
    set.add(listener as DomainListener<never>);
    return () => set.delete(listener as DomainListener<never>);
  }

  async emit<E extends DomainEventName>(event: E, payload: DomainEventMap[E]): Promise<void> {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        await (listener as DomainListener<E>)(payload);
      } catch (error) {
        this.log.warn(`${event} listener failed`, { userId: payload.userId, error });
      }
    }
  }
}

/** The process's bus: emitters sit deep inside graders that carry no bus of their own. */
export const domainEvents = new DomainEvents(createLogger({ bindings: { module: "events" } }));
