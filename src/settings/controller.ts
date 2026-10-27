import type { SettingsCallback } from "../bot/callbacks";
import type { BotContext } from "../bot/context";
import type { Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { setActiveProviderModel } from "../db/repositories/providers";
import { getSettings, type SettingsPatch, updateSettings } from "../db/repositories/users";
import type { SettingsEvents, SettingsField } from "../events/settings-events";
import type { HubService } from "../hub/hub-service";
import { getOverallLevel, seedLevels } from "../levels";
import { whileTyping } from "../sessions/answer";
import {
  type ByokChoice,
  INTEREST_SUGGESTIONS,
  MAX_INTERESTS,
  MODEL_PAGE_SIZE,
  type ProviderChoice,
} from "./options";
import type { Notice, ProviderSettings } from "./provider";
import { renderSettings, type SettingsView } from "./screens";
import { providerKey, type SettingsInput } from "./state";
import {
  mergeInterests,
  parseApiKey,
  parseBaseUrl,
  parseInterests,
  parseModelId,
  parseProfession,
  parseTimezone,
  parseWorkspaceId,
  timezoneAt,
  toggleInterest,
} from "./validate";

export interface SettingsControllerDeps {
  db: Db;
  hub: HubService;
  i18n: Translator;
  events: SettingsEvents;
  providers: ProviderSettings;
  /** Starts the placement test again (the onboarding module). */
  placement: { retake(ctx: BotContext): Promise<void> };
}

type PendingInput = SettingsInput extends infer I
  ? I extends unknown
    ? Omit<I, "since">
    : never
  : never;

/** The page a cancelled text input returns to. */
function cancelPage(
  pending: SettingsInput | undefined,
): "timezone" | "interests" | "profile" | "provider" {
  switch (pending?.kind) {
    case "timezone":
      return "timezone";
    case "interests":
      return "interests";
    case "profession":
      return "profile";
    default:
      return "provider";
  }
}

/**
 * The settings screens. Every screen is the hub message edited in place; free-text values are
 * asked for by editing the hub into a prompt (docs/ARCHITECTURE.md → Telegram UX rules), so
 * settings never send a message of their own.
 */
export class SettingsController {
  constructor(private readonly deps: SettingsControllerDeps) {}

  show(ctx: BotContext, view: SettingsView): Promise<void> {
    const { db, hub, i18n, providers } = this.deps;
    return hub.present(ctx.user, async () => {
      const [settings, provider, level] = await Promise.all([
        getSettings(db, ctx.user.id),
        providers.active(ctx.user.id),
        getOverallLevel(db, ctx.user.id),
      ]);
      if (!settings) throw new Error(`user ${ctx.user.id} has no settings`);
      return renderSettings(i18n, view, {
        locale: settings.uiLang,
        settings,
        level: level?.label,
        provider,
      });
    });
  }

  /** A settings button on the current hub. */
  async onCallback(ctx: BotContext, callback: SettingsCallback): Promise<void> {
    const pending = ctx.session.settingsInput;
    // Any settings button abandons the value the hub was asking for.
    ctx.session.settingsInput = undefined;

    switch (callback.type) {
      case "settings":
        // Opening the model picker asks the provider for its models: a loading toast meanwhile.
        await ctx.answerCallbackQuery(
          callback.page === "model" && callback.n === undefined
            ? { text: ctx.t("settings-models-loading") }
            : undefined,
        );
        if (callback.page === "model") return this.showModels(ctx, callback.n);
        return this.show(ctx, { page: callback.page, n: callback.n });
      case "lang":
        await ctx.answerCallbackQuery();
        return this.apply(ctx, { uiLang: callback.lang }, ["uiLang"]);
      case "set":
        await ctx.answerCallbackQuery();
        return this.apply(
          ctx,
          { [callback.change.field]: callback.change.value } as SettingsPatch,
          [callback.change.field],
        );
      case "placement":
        await ctx.answerCallbackQuery();
        return this.deps.placement.retake(ctx);
      case "provider":
        return this.chooseProvider(ctx, callback.choice);
      case "provider-key":
        await ctx.answerCallbackQuery();
        return this.askForKey(ctx, callback.choice);
      case "provider-reuse": {
        await ctx.answerCallbackQuery();
        const switched = await this.deps.providers.reuse(ctx.user.id, callback.choice);
        if (switched) await this.changed(ctx, ["provider"]);
        return this.show(ctx, {
          page: "provider",
          notice: switched ? { key: "provider-switched" } : undefined,
        });
      }
      case "model":
        return this.pickModel(ctx, callback.index);
      case "input":
        await ctx.answerCallbackQuery();
        return this.ask(ctx, { kind: callback.input });
      case "input-cancel":
        await ctx.answerCallbackQuery();
        return this.show(ctx, { page: cancelPage(pending) });
      case "goal": {
        await ctx.answerCallbackQuery();
        const goals = ctx.settings.goals.includes(callback.goal)
          ? ctx.settings.goals.filter((goal) => goal !== callback.goal)
          : [...ctx.settings.goals, callback.goal];
        return this.saveProfile(ctx, { goals }, "profile");
      }
      case "interest": {
        const id = INTEREST_SUGGESTIONS[callback.index] ?? "";
        const current = ctx.settings.interests;
        const interests = toggleInterest(current, id);
        const full = current.length >= MAX_INTERESTS && interests.length === current.length;
        await ctx.answerCallbackQuery(
          full ? { text: ctx.t("profile-interests-full", { max: MAX_INTERESTS }) } : undefined,
        );
        return this.saveProfile(ctx, { interests }, "interests");
      }
      case "profile-clear":
        await ctx.answerCallbackQuery();
        return callback.field === "interests"
          ? this.saveProfile(ctx, { interests: [] }, "interests")
          : this.saveProfile(ctx, { profession: null }, "profile");
      case "provider-test": {
        await ctx.answerCallbackQuery({ text: ctx.t("provider-testing") });
        const { notice, needsWorkspace } = await this.deps.providers.test(ctx.user.id);
        // The key works only inside a workspace: ask for its ID right away.
        if (needsWorkspace) return this.ask(ctx, { kind: "workspace" }, notice);
        return this.show(ctx, { page: "provider", notice });
      }
      case "provider-workspace-clear": {
        await ctx.answerCallbackQuery();
        const cleared = await this.deps.providers.setWorkspace(ctx.user.id, null);
        if (cleared) await this.changed(ctx, ["provider"]);
        return this.show(ctx, {
          page: "provider",
          notice: cleared ? { key: "provider-workspace-cleared" } : undefined,
        });
      }
    }
  }

  /**
   * The message answering a pending input. The input middleware has already deleted it; the text
   * may be an API key, so it goes nowhere but the validator and the provider check.
   */
  async onInput(ctx: BotContext, pending: SettingsInput): Promise<void> {
    const text = ctx.message?.text ?? "";
    const userId = ctx.user.id;
    const retry = (notice: Notice) => this.ask(ctx, pending, notice);

    switch (pending.kind) {
      case "key": {
        const apiKey = parseApiKey(text);
        if (!apiKey) return retry({ key: "input-key-invalid" });
        const result = await this.deps.providers.submitKey(
          userId,
          pending.choice,
          apiKey,
          pending.baseUrl,
        );
        if (!result.ok) return retry(result.notice);
        ctx.session.settingsInput = undefined;
        await this.changed(ctx, ["provider"]);
        return this.show(ctx, { page: "provider", notice: { key: "provider-key-saved" } });
      }
      case "base-url": {
        const baseUrl = parseBaseUrl(text);
        if (!baseUrl) return retry({ key: "input-base-url-invalid" });
        return this.ask(ctx, { kind: "key", choice: "custom", baseUrl });
      }
      case "model": {
        const model = parseModelId(text);
        if (!model) return retry({ key: "input-model-invalid" });
        ctx.session.settingsInput = undefined;
        return this.setModel(ctx, model);
      }
      case "workspace": {
        const workspaceId = parseWorkspaceId(text);
        if (!workspaceId) return retry({ key: "input-workspace-invalid" });
        ctx.session.settingsInput = undefined;
        const saved = await this.deps.providers.setWorkspace(userId, workspaceId);
        if (saved) await this.changed(ctx, ["provider"]);
        return this.show(ctx, {
          page: "provider",
          notice: saved ? { key: "provider-workspace-set" } : undefined,
        });
      }
      case "timezone": {
        const location = ctx.message?.location;
        const timezone = location
          ? timezoneAt(location.latitude, location.longitude)
          : parseTimezone(text);
        if (!timezone) return retry({ key: "input-timezone-invalid" });
        ctx.session.settingsInput = undefined;
        await updateSettings(this.deps.db, userId, { timezone });
        await this.changed(ctx, ["timezone"]);
        return this.show(ctx, {
          page: "root",
          notice: { key: "settings-timezone-set", vars: { timezone } },
        });
      }
      case "interests": {
        const added = parseInterests(text);
        if (!added) return retry({ key: "input-interests-invalid" });
        ctx.session.settingsInput = undefined;
        const interests = mergeInterests(ctx.settings.interests, added);
        return this.saveProfile(ctx, { interests }, "interests");
      }
      case "profession": {
        const profession = parseProfession(text);
        if (!profession) return retry({ key: "input-profession-invalid" });
        ctx.session.settingsInput = undefined;
        return this.saveProfile(ctx, { profession }, "profile");
      }
    }
  }

  /** Saves profile fields and shows the profile page they were edited on. */
  private async saveProfile(
    ctx: BotContext,
    patch: Pick<SettingsPatch, "goals" | "interests" | "profession">,
    page: "profile" | "interests",
  ): Promise<void> {
    await updateSettings(this.deps.db, ctx.user.id, patch);
    await this.changed(ctx, Object.keys(patch) as SettingsField[]);
    return this.show(ctx, { page });
  }

  private async apply(ctx: BotContext, patch: SettingsPatch, changed: SettingsField[]) {
    // The first level comes from the placement test (the hub stays locked until it is done); a
    // level button from an older screen cannot skip it.
    if (patch.cefrLevel && ctx.settings.cefrLevel === null) {
      return this.show(ctx, { page: "root" });
    }
    // A chosen level restarts the level model there; re-picking the current band keeps it.
    if (patch.cefrLevel && patch.cefrLevel !== ctx.settings.cefrLevel) {
      await seedLevels(this.deps.db, ctx.user.id, patch.cefrLevel, "chosen");
    }
    await updateSettings(this.deps.db, ctx.user.id, patch);
    await this.changed(ctx, changed);
    await this.show(ctx, { page: "root" });
  }

  private changed(ctx: BotContext, changed: SettingsField[]) {
    return this.deps.events.emit({ userId: ctx.user.id, changed });
  }

  /** Turns the hub into a prompt and waits for the user's next message. */
  private ask(ctx: BotContext, input: PendingInput, notice?: Notice): Promise<void> {
    const pending = { ...input, since: Date.now() } as SettingsInput;
    ctx.session.settingsInput = pending;
    return this.show(ctx, { page: "input", input: pending, notice });
  }

  private askForKey(ctx: BotContext, choice: ByokChoice): Promise<void> {
    return this.ask(ctx, choice === "custom" ? { kind: "base-url" } : { kind: "key", choice });
  }

  private async chooseProvider(ctx: BotContext, choice: ProviderChoice): Promise<void> {
    const userId = ctx.user.id;
    switch (choice) {
      case "runner":
        await ctx.answerCallbackQuery({ text: ctx.t("provider-unavailable-runner") });
        return;
      case "server":
      case "claude-code":
        await ctx.answerCallbackQuery();
        await this.deps.providers.activateKeyless(userId, choice);
        await this.changed(ctx, ["provider"]);
        return this.show(ctx, { page: "provider", notice: { key: "provider-switched" } });
      default: {
        await ctx.answerCallbackQuery();
        const saved = await this.deps.providers.saved(userId, choice);
        if (saved) return this.show(ctx, { page: "setup", choice, saved });
        return this.askForKey(ctx, choice);
      }
    }
  }

  /** Lists models afresh when the picker opens; page turns reuse the list the buttons index. */
  private async showModels(ctx: BotContext, n: number | undefined): Promise<void> {
    const provider = await this.deps.providers.active(ctx.user.id);
    const key = providerKey(provider);
    let list = ctx.session.modelList;
    if (n === undefined || list?.provider !== key) {
      const ids = await whileTyping(ctx, () => this.deps.providers.listModels(ctx.user.id));
      list = { provider: key, ids };
      ctx.session.modelList = list;
    }
    const current = provider?.model ? list.ids.indexOf(provider.model) : -1;
    const page = n ?? (current < 0 ? 0 : Math.floor(current / MODEL_PAGE_SIZE));
    await this.show(ctx, { page: "model", n: page, ids: list.ids });
  }

  private async pickModel(ctx: BotContext, index: number | "default"): Promise<void> {
    if (index === "default") {
      await ctx.answerCallbackQuery();
      return this.setModel(ctx, null);
    }
    const provider = await this.deps.providers.active(ctx.user.id);
    const list = ctx.session.modelList;
    const model = list?.provider === providerKey(provider) ? list.ids[index] : undefined;
    if (!model) {
      await ctx.answerCallbackQuery({ text: ctx.t("hub-outdated") });
      return this.showModels(ctx, undefined);
    }
    await ctx.answerCallbackQuery();
    return this.setModel(ctx, model);
  }

  private async setModel(ctx: BotContext, model: string | null): Promise<void> {
    const updated = await setActiveProviderModel(this.deps.db, ctx.user.id, model);
    if (updated) await this.changed(ctx, ["provider"]);
    await this.show(ctx, {
      page: "provider",
      notice: updated ? { key: "provider-model-set" } : undefined,
    });
  }
}
