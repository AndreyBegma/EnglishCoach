import type { XpSource } from "../db/schema";
import { createLogger, type Logger } from "../log";

/** One XP award, after the ledger has it. */
export interface XpAwarded {
  userId: number;
  source: XpSource;
  amount: number;
  meta: Record<string, unknown>;
  /** The learner's XP total after the award. */
  total: number;
  /** The profile level after the award; `level > previousLevel` is a level-up. */
  level: number;
  previousLevel: number;
}

export type XpListener = (event: XpAwarded) => void | Promise<void>;

/**
 * The `xp.awarded` hook. Modules that react to XP (achievements, level-up notices) subscribe here
 * instead of being called by the rules. A failing listener is logged and never fails the award,
 * nor the other listeners.
 */
export class XpEvents {
  private readonly listeners = new Set<XpListener>();

  constructor(private readonly log: Logger) {}

  /** Subscribes to `xp.awarded`; returns the unsubscribe function. */
  on(_event: "xp.awarded", listener: XpListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emit(event: XpAwarded): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        this.log.warn("xp.awarded listener failed", { userId: event.userId, error });
      }
    }
  }
}

/**
 * The process's bus. Awards come from deep inside graders that carry no bus of their own, so it
 * is a module singleton; subscribers register at boot.
 */
export const xpLog = createLogger({ bindings: { module: "xp" } });
export const xpEvents = new XpEvents(xpLog);
