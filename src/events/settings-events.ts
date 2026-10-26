import type { UserSettings } from "../db/schema";
import type { Logger } from "../log";

/** A user setting, or `provider` for the LLM provider, model or key. */
export type SettingsField = Exclude<keyof UserSettings, "userId"> | "provider";

export interface SettingsChanged {
  userId: number;
  changed: SettingsField[];
}

export type SettingsListener = (event: SettingsChanged) => void | Promise<void>;

/**
 * The `settings.changed` hook. Modules that depend on settings (routine scheduling, reminders)
 * subscribe here instead of being called by the settings screen. A failing listener is logged and
 * never fails the update that changed the setting, nor the other listeners.
 */
export class SettingsEvents {
  private readonly listeners = new Set<SettingsListener>();

  constructor(private readonly log: Logger) {}

  /** Subscribes to `settings.changed`; returns the unsubscribe function. */
  on(_event: "settings.changed", listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emit(event: SettingsChanged): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        this.log.warn("settings.changed listener failed", { userId: event.userId, error });
      }
    }
  }
}
