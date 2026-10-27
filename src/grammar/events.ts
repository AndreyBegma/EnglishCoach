import { createLogger, type Logger } from "../log";

/** A syllabus topic just became mastered. */
export interface TopicMastered {
  userId: number;
  topicId: string;
  at: Date;
  /** The topic's first mastery ever; false when it is mastered again after shaky or a failed check. */
  first: boolean;
}

export type TopicListener = (event: TopicMastered) => void | Promise<void>;

/**
 * The `topic.mastered` hook. Modules that react to mastery (achievements, notices) subscribe here
 * instead of being called by the recorder. A failing listener is logged and never fails the item
 * that mastered the topic, nor the other listeners.
 */
export class TopicEvents {
  private readonly listeners = new Set<TopicListener>();

  constructor(private readonly log: Logger) {}

  /** Subscribes to `topic.mastered`; returns the unsubscribe function. */
  on(_event: "topic.mastered", listener: TopicListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emit(event: TopicMastered): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        this.log.warn("topic.mastered listener failed", { userId: event.userId, error });
      }
    }
  }
}

/** The process's bus; like `xpEvents`, a module singleton because graders carry no bus. */
export const topicLog = createLogger({ bindings: { module: "topics" } });
export const topicEvents = new TopicEvents(topicLog);
