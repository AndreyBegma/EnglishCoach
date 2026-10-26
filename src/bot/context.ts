import type { I18nFlavor } from "@grammyjs/i18n";
import type { Context, SessionFlavor } from "grammy";
import type { User, UserSettings } from "../db/schema";
import type { LearningHandle } from "../sessions/session-manager";
import type { ModelListState, SettingsInput } from "../settings/state";

/**
 * Multi-step conversation state, kept in Redis by grammY's session plugin (`ctx.session`).
 * Feature slots add their own optional keys here; nothing in it is authoritative state — the
 * database is.
 */
export interface FlowState {
  demo?: { sessionId: number; echoed: number };
  settingsInput?: SettingsInput;
  modelList?: ModelListState;
}

/**
 * Naming rule for every handler:
 * - `ctx.session` is grammY's session (FlowState above, stored in Redis). Do not reuse the name.
 * - `ctx.learning` is the active learning session (a `learning_sessions` row), set for any update
 *   from a user who has one. Send session messages with `ctx.learning.send/reply` so cleanup can
 *   delete them; never `ctx.reply` inside a session.
 */
export interface AppFlavor {
  /** Set by the access middleware before any other handler runs. */
  user: User;
  settings: UserSettings;
  isAdmin: boolean;
  learning?: LearningHandle;
}

export type BotContext = Context & I18nFlavor & SessionFlavor<FlowState> & AppFlavor;
