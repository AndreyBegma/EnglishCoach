import type { ByokChoice } from "./options";

/**
 * A settings value the bot is waiting for as a message. While it is set, the hub shows the prompt
 * and the user's next message is consumed (and deleted) by the settings input middleware.
 * Never holds the key itself.
 */
export type SettingsInput = { since: number } & (
  | { kind: "key"; choice: ByokChoice; baseUrl?: string }
  | { kind: "base-url" }
  | { kind: "model" }
  | { kind: "workspace" }
  | { kind: "timezone" }
  | { kind: "interests" }
  | { kind: "profession" }
);

/** A pending input older than this is dropped; the message is then handled as usual. */
export const SETTINGS_INPUT_TTL_MS = 10 * 60_000;

/**
 * The model list shown by the picker. Buttons carry an index into it (model IDs can exceed the
 * 64-byte callback limit), so it is kept with the provider it was listed for.
 */
export interface ModelListState {
  provider: string;
  ids: string[];
}

/** The key identifying the active provider in `ModelListState.provider`. */
export function providerKey(provider: { kind: string; baseUrl: string | null } | undefined) {
  return provider ? `${provider.kind}|${provider.baseUrl ?? ""}` : "server|";
}
