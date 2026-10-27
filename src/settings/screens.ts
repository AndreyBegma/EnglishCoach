import { InlineKeyboard as Keyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { type Callback, encodeCallback, type SettingsPage } from "../bot/callbacks";
import { type Locale, SUPPORTED_LOCALES, type Translator } from "../bot/i18n";
import type { UserSettings } from "../db/schema";
import type { RenderedScreen } from "../hub/screens";
import {
  type ByokChoice,
  CEFR_LEVELS,
  COMMON_TIMEZONES,
  INTEREST_SUGGESTIONS,
  LEARNER_GOALS,
  MAX_INTERESTS,
  MODEL_PAGE_SIZE,
  type ProviderChoice,
  TIME_PAGE_SIZE,
  TIME_SLOTS,
  WORDS_PER_DAY,
} from "./options";
import type { Notice, ProviderView } from "./provider";
import type { SettingsInput } from "./state";

export type SettingsView =
  | { page: Exclude<SettingsPage, "model">; n?: number; notice?: Notice }
  | { page: "model"; n: number; ids: string[]; notice?: Notice }
  /** A bring-your-own-key choice with a key saved earlier: reuse it or enter a new one. */
  | { page: "setup"; choice: ByokChoice; saved: ProviderView }
  /** The hub turned into a prompt for a typed value. */
  | { page: "input"; input: SettingsInput; notice?: Notice };

export interface SettingsModel {
  locale: Locale;
  settings: UserSettings;
  /** The overall level from the level model, "B1.6"; undefined until there is one. */
  level?: string;
  /** Undefined means no config was ever chosen: the server provider. */
  provider?: ProviderView;
}

type T = (key: string, variables?: Record<string, string | number>) => string;

const button = (label: string, data: Callback) => Keyboard.text(label, encodeCallback(data));
const mark = (label: string, selected: boolean) => (selected ? `✓ ${label}` : label);
const chunk = <V>(items: readonly V[], size: number): V[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

/** Postgres returns `time` as `HH:MM:SS`. */
const hhmm = (time: string) => time.slice(0, 5);

/** Which half of the day the time picker opens on. */
export function timePageOf(time: string): number {
  const index = TIME_SLOTS.indexOf(hhmm(time));
  return index < 0 ? 0 : Math.floor(index / TIME_PAGE_SIZE);
}

/** The choice the provider screen marks as selected. */
function activeChoice(provider: ProviderView | undefined): string {
  if (!provider) return "server";
  return provider.choice ?? provider.kind;
}

export function providerLabel(t: T, provider: ProviderView | undefined): string {
  switch (activeChoice(provider)) {
    case "anthropic":
      return t("provider-anthropic");
    case "openai":
      return t("provider-openai");
    case "openrouter":
      return t("provider-openrouter");
    case "custom": {
      const host = provider?.baseUrl ? new URL(provider.baseUrl).host : "?";
      return t("provider-custom-host", { host });
    }
    case "claude-code":
      return t("provider-claude-code");
    default:
      return t("provider-server");
  }
}

function choiceLabel(t: T, choice: ByokChoice): string {
  return choice === "custom" ? t("provider-custom-key") : t(`provider-${choice}`);
}

/** The server provider runs with the owner's model; every other kind can pick one. */
const hasModelChoice = (provider: ProviderView | undefined) =>
  provider !== undefined && provider.kind !== "server" && provider.kind !== "runner";

function withNotice(t: T, lines: string[], notice: Notice | undefined): string[] {
  if (!notice) return lines;
  const said = notice.detail ? [t("provider-error-detail", { detail: notice.detail })] : [];
  return [...lines, "", t(notice.key, notice.vars), ...said];
}

const isAnthropic = (provider: ProviderView | undefined) => provider?.kind === "anthropic";

function rootScreen(t: T, model: SettingsModel, notice?: Notice): RenderedScreen {
  const { settings } = model;
  const onOff = (value: boolean) => t(value ? "settings-on" : "settings-off");
  const text = [
    t("settings-title"),
    "",
    t("settings-ui-lang", { lang: t(`lang-${settings.uiLang}`) }),
    t("settings-explain-lang", { lang: t(`lang-${settings.explainLang}`) }),
    t("settings-level", { level: model.level ?? t("settings-level-unset") }),
    t("settings-words", { count: settings.wordsPerDay }),
    t("settings-timezone", { timezone: settings.timezone }),
    t("settings-times", {
      morning: hhmm(settings.morningTime),
      evening: hhmm(settings.eveningTime),
    }),
    t("settings-reminders", { state: onOff(settings.remindersEnabled) }),
    t("settings-voice", { state: onOff(settings.voiceEnabled) }),
    t("settings-english-variant", { variant: t(`english-variant-${settings.englishVariant}`) }),
    t("settings-provider", { provider: providerLabel(t, model.provider) }),
  ];
  const page = (label: string, target: SettingsPage) =>
    button(t(label), { type: "settings", page: target });
  return {
    text: withNotice(t, text, notice).join("\n"),
    keyboard: Keyboard.from([
      [page("settings-btn-ui-lang", "lang"), page("settings-btn-explain-lang", "explain")],
      [page("settings-btn-level", "level"), page("settings-btn-words", "words")],
      [page("settings-btn-timezone", "timezone")],
      [page("settings-btn-morning", "morning"), page("settings-btn-evening", "evening")],
      [
        button(t("settings-btn-reminders", { state: onOff(settings.remindersEnabled) }), {
          type: "set",
          change: { field: "remindersEnabled", value: !settings.remindersEnabled },
        }),
        button(t("settings-btn-voice", { state: onOff(settings.voiceEnabled) }), {
          type: "set",
          change: { field: "voiceEnabled", value: !settings.voiceEnabled },
        }),
      ],
      [
        button(
          t("settings-btn-english-variant", {
            variant: t(`english-variant-${settings.englishVariant}`),
          }),
          {
            type: "set",
            change: {
              field: "englishVariant",
              value: settings.englishVariant === "us" ? "uk" : "us",
            },
          },
        ),
      ],
      [page("settings-btn-profile", "profile")],
      [page("settings-btn-provider", "provider")],
      [button(t("hub-back"), { type: "screen", screen: "main" })],
    ]),
  };
}

/** How an interest reads: a suggestion through its label, a typed one as typed. */
export function interestLabel(t: T, interest: string): string {
  return (INTEREST_SUGGESTIONS as readonly string[]).includes(interest)
    ? t(`interest-${interest}`)
    : interest;
}

/** The learner's interests as one line, or the "none" placeholder. */
export function interestsLine(t: T, interests: readonly string[]): string {
  return interests.length > 0
    ? interests.map((interest) => interestLabel(t, interest)).join(", ")
    : t("profile-none");
}

function profileScreen(t: T, model: SettingsModel, notice?: Notice): RenderedScreen {
  const { goals, interests, profession } = model.settings;
  const lines = [
    t("profile-title"),
    "",
    t("profile-goals", {
      goals:
        goals.length > 0 ? goals.map((goal) => t(`goal-${goal}`)).join(", ") : t("profile-none"),
    }),
    t("profile-interests", { interests: interestsLine(t, interests) }),
    t("profile-profession", { profession: profession ?? t("profile-none") }),
  ];
  const professionRow = [
    button(t("profile-btn-profession"), { type: "input", input: "profession" }),
  ];
  if (profession) {
    professionRow.push(
      button(t("profile-btn-clear-profession"), { type: "profile-clear", field: "profession" }),
    );
  }
  return {
    text: withNotice(t, lines, notice).join("\n"),
    keyboard: Keyboard.from([
      ...chunk(LEARNER_GOALS, 2).map((row) =>
        row.map((goal) =>
          button(mark(t(`goal-${goal}`), goals.includes(goal)), { type: "goal", goal }),
        ),
      ),
      [button(t("profile-btn-interests"), { type: "settings", page: "interests" })],
      professionRow,
      [button(t("hub-back"), { type: "settings", page: "root" })],
    ]),
  };
}

function interestsScreen(t: T, model: SettingsModel, notice?: Notice): RenderedScreen {
  const { interests } = model.settings;
  const chosen = new Set(interests.map((interest) => interest.toLowerCase()));
  const lines = [
    t("profile-interests-title", { max: MAX_INTERESTS }),
    "",
    t("profile-interests", { interests: interestsLine(t, interests) }),
  ];
  const actions = [button(t("profile-btn-type-interests"), { type: "input", input: "interests" })];
  if (interests.length > 0) {
    actions.push(button(t("profile-btn-clear"), { type: "profile-clear", field: "interests" }));
  }
  return {
    text: withNotice(t, lines, notice).join("\n"),
    keyboard: Keyboard.from([
      ...chunk(INTEREST_SUGGESTIONS, 3).map((row) =>
        row.map((id) =>
          button(mark(t(`interest-${id}`), chosen.has(id)), {
            type: "interest",
            index: INTEREST_SUGGESTIONS.indexOf(id),
          }),
        ),
      ),
      actions,
      [button(t("hub-back"), { type: "settings", page: "profile" })],
    ]),
  };
}

function providerScreen(t: T, model: SettingsModel, notice?: Notice): RenderedScreen {
  const { provider } = model;
  const selected = activeChoice(provider);
  const lines = [
    t("provider-title"),
    "",
    // The title already says "AI provider"; the line under it names only the choice.
    t("provider-current", { provider: providerLabel(t, provider) }),
  ];
  if (hasModelChoice(provider)) {
    lines.push(t("provider-model", { model: provider?.model ?? t("provider-model-default") }));
  }
  if (provider?.keyHint) lines.push(t("provider-key-hint", { hint: provider.keyHint }));
  if (provider?.workspaceId) {
    lines.push(t("provider-workspace", { workspace: provider.workspaceId }));
  }

  const choose = (choice: ProviderChoice, label: string) =>
    button(mark(label, selected === choice), { type: "provider", choice });
  const rows: InlineKeyboardButton[][] = [
    [choose("server", t("provider-server")), choose("claude-code", t("provider-claude-code"))],
    [choose("anthropic", t("provider-anthropic"))],
    [choose("openai", t("provider-openai")), choose("openrouter", t("provider-openrouter"))],
    [choose("custom", t("provider-custom"))],
    [choose("runner", t("provider-runner"))],
  ];
  const actions = [button(t("provider-btn-test"), { type: "provider-test" })];
  if (hasModelChoice(provider)) {
    actions.unshift(button(t("provider-btn-model"), { type: "settings", page: "model" }));
  }
  rows.push(actions);
  if (isAnthropic(provider)) {
    const workspace = [button(t("provider-btn-workspace"), { type: "input", input: "workspace" })];
    if (provider?.workspaceId) {
      workspace.push(
        button(t("provider-btn-workspace-clear"), { type: "provider-workspace-clear" }),
      );
    }
    rows.push(workspace);
  }
  rows.push([button(t("hub-back"), { type: "settings", page: "root" })]);
  return { text: withNotice(t, lines, notice).join("\n"), keyboard: Keyboard.from(rows) };
}

function modelScreen(
  t: T,
  model: SettingsModel,
  view: Extract<SettingsView, { page: "model" }>,
): RenderedScreen {
  const current = model.provider?.model ?? null;
  const pages = Math.max(1, Math.ceil(view.ids.length / MODEL_PAGE_SIZE));
  const n = Math.min(Math.max(view.n, 0), pages - 1);
  const first = n * MODEL_PAGE_SIZE;
  const lines = [t("model-title", { model: current ?? t("provider-model-default") })];
  if (view.ids.length === 0) lines.push("", t("model-list-empty"));
  else if (pages > 1) lines.push("", t("model-page", { page: n + 1, pages }));

  const rows: InlineKeyboardButton[][] = view.ids
    .slice(first, first + MODEL_PAGE_SIZE)
    .map((id, i) => [button(mark(id, id === current), { type: "model", index: first + i })]);
  const nav: InlineKeyboardButton[] = [];
  if (n > 0) nav.push(button("‹", { type: "settings", page: "model", n: n - 1 }));
  if (n < pages - 1) nav.push(button("›", { type: "settings", page: "model", n: n + 1 }));
  if (nav.length > 0) rows.push(nav);
  rows.push(
    [
      button(mark(t("model-btn-default"), current === null), { type: "model", index: "default" }),
      button(t("model-btn-type"), { type: "input", input: "model" }),
    ],
    [button(t("hub-back"), { type: "settings", page: "provider" })],
  );
  return { text: withNotice(t, lines, view.notice).join("\n"), keyboard: Keyboard.from(rows) };
}

function timeScreen(
  t: T,
  model: SettingsModel,
  which: "morning" | "evening",
  requestedPage: number | undefined,
): RenderedScreen {
  const field = which === "morning" ? "morningTime" : "eveningTime";
  const current = hhmm(model.settings[field]);
  const page = Math.min(Math.max(requestedPage ?? timePageOf(current), 0), 1);
  const slots = TIME_SLOTS.slice(page * TIME_PAGE_SIZE, (page + 1) * TIME_PAGE_SIZE);
  const other = page === 0 ? 1 : 0;
  const otherSlots = TIME_SLOTS.slice(other * TIME_PAGE_SIZE, (other + 1) * TIME_PAGE_SIZE);
  const range = `${otherSlots[0]}–${otherSlots[otherSlots.length - 1]}`;
  return {
    text: t(`settings-choose-${which}`, { time: current }),
    keyboard: Keyboard.from([
      ...chunk(slots, 4).map((row) =>
        row.map((slot) =>
          button(mark(slot, slot === current), { type: "set", change: { field, value: slot } }),
        ),
      ),
      [
        button(page === 0 ? `${range} ›` : `‹ ${range}`, {
          type: "settings",
          page: which,
          n: other,
        }),
      ],
      [button(t("hub-back"), { type: "settings", page: "root" })],
    ]),
  };
}

function inputScreen(
  t: T,
  model: SettingsModel,
  view: Extract<SettingsView, { page: "input" }>,
): RenderedScreen {
  const { input } = view;
  const text =
    input.kind === "key"
      ? t("input-key", { provider: choiceLabel(t, input.choice) })
      : t(`input-${input.kind}`, {
          model: model.provider?.model ?? t("provider-model-default"),
          workspace: model.provider?.workspaceId ?? "—",
          profession: model.settings.profession ?? "—",
          max: MAX_INTERESTS,
        });
  return {
    text: withNotice(t, [text], view.notice).join("\n"),
    keyboard: Keyboard.from([[button(t("input-cancel"), { type: "input-cancel" })]]),
  };
}

/** Renders one settings screen into the hub message. Pure: everything it shows is in `model`. */
export function renderSettings(
  i18n: Translator,
  view: SettingsView,
  model: SettingsModel,
): RenderedScreen {
  const t: T = (key, variables) => i18n.t(model.locale, key, variables);
  const back = [button(t("hub-back"), { type: "settings", page: "root" })];
  const { settings } = model;

  switch (view.page) {
    case "root":
      return rootScreen(t, model, view.notice);
    case "lang":
      return {
        text: t("settings-choose-ui-lang"),
        keyboard: Keyboard.from([
          SUPPORTED_LOCALES.map((lang) =>
            button(mark(t(`lang-${lang}`), lang === settings.uiLang), { type: "lang", lang }),
          ),
          back,
        ]),
      };
    case "explain":
      return {
        text: t("settings-choose-explain-lang"),
        keyboard: Keyboard.from([
          SUPPORTED_LOCALES.map((lang) =>
            button(mark(t(`lang-${lang}`), lang === settings.explainLang), {
              type: "set",
              change: { field: "explainLang", value: lang },
            }),
          ),
          back,
        ]),
      };
    case "level":
      return {
        text: t("settings-choose-level", {
          level: model.level ?? t("settings-level-unset"),
        }),
        keyboard: Keyboard.from([
          ...chunk(CEFR_LEVELS, 3).map((row) =>
            row.map((level) =>
              button(mark(level, level === settings.cefrLevel), {
                type: "set",
                change: { field: "cefrLevel", value: level },
              }),
            ),
          ),
          [button(t("settings-btn-placement"), { type: "placement" })],
          back,
        ]),
      };
    case "words":
      return {
        text: t("settings-choose-words"),
        keyboard: Keyboard.from([
          WORDS_PER_DAY.map((count) =>
            button(mark(String(count), count === settings.wordsPerDay), {
              type: "set",
              change: { field: "wordsPerDay", value: count },
            }),
          ),
          back,
        ]),
      };
    case "timezone":
      return {
        text: withNotice(
          t,
          [t("settings-choose-timezone", { timezone: settings.timezone })],
          view.notice,
        ).join("\n"),
        keyboard: Keyboard.from([
          ...chunk(COMMON_TIMEZONES, 2).map((row) =>
            row.map((timezone) =>
              button(mark(timezone, timezone === settings.timezone), {
                type: "set",
                change: { field: "timezone", value: timezone },
              }),
            ),
          ),
          [button(t("settings-btn-timezone-other"), { type: "input", input: "timezone" })],
          back,
        ]),
      };
    case "morning":
    case "evening":
      return timeScreen(t, model, view.page, view.n);
    case "provider":
      return providerScreen(t, model, view.notice);
    case "profile":
      return profileScreen(t, model, view.notice);
    case "interests":
      return interestsScreen(t, model, view.notice);
    case "model":
      return modelScreen(t, model, view);
    case "setup":
      return {
        text: t("provider-setup-saved", {
          provider: choiceLabel(t, view.choice),
          hint: view.saved.keyHint ?? "…",
        }),
        keyboard: Keyboard.from([
          [button(t("provider-btn-reuse"), { type: "provider-reuse", choice: view.choice })],
          [button(t("provider-btn-new-key"), { type: "provider-key", choice: view.choice })],
          [button(t("hub-back"), { type: "settings", page: "provider" })],
        ]),
      };
    case "input":
      return inputScreen(t, model, view);
  }
}
