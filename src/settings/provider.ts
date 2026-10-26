import { z } from "zod";
import type { Db } from "../db/client";
import {
  activateProviderConfig,
  getActiveProviderConfig,
  listProviderConfigs,
  providerKeyHint,
  reactivateProviderConfig,
} from "../db/repositories/providers";
import type { ProviderConfig } from "../db/schema";
import {
  defaultFactories,
  LlmOutputError,
  type LlmProvider,
  LlmProviderError,
  type ProviderFactories,
  ProviderUnavailableError,
  resolveProvider,
} from "../llm";
import type { ServerEnv } from "../llm/providers/server";
import type { Logger } from "../log";
import { type ByokChoice, OPENAI_PRESET_URLS } from "./options";

export interface ProviderSettingsDeps {
  db: Db;
  env: ServerEnv;
  masterKey: Buffer;
  /** Tests replace the SDK-backed providers. */
  factories?: ProviderFactories;
  log: Logger;
}

/** An i18n key with its variables: what the provider screen says after an action. */
export interface Notice {
  key: string;
  vars?: Record<string, string | number>;
}

/** The active provider as the settings screens show it. The key appears only masked. */
export interface ProviderView {
  kind: ProviderConfig["kind"];
  /** Which OpenAI-compatible preset an `openai` config is; undefined for other kinds. */
  choice?: ByokChoice;
  model: string | null;
  baseUrl: string | null;
  keyHint?: string;
}

const kindOf = (choice: ByokChoice) => (choice === "anthropic" ? "anthropic" : "openai");

/** Which preset an `openai` config's base URL belongs to. */
export function openAiChoice(baseUrl: string | null): ByokChoice {
  if (baseUrl === OPENAI_PRESET_URLS.openai) return "openai";
  if (baseUrl === OPENAI_PRESET_URLS.openrouter) return "openrouter";
  return "custom";
}

function choiceOf(config: ProviderConfig): ByokChoice | undefined {
  if (config.kind === "anthropic") return "anthropic";
  if (config.kind === "openai") return openAiChoice(config.baseUrl);
  return undefined;
}

export class ProviderSettings {
  constructor(private readonly deps: ProviderSettingsDeps) {}

  async active(userId: number): Promise<ProviderView | undefined> {
    const config = await getActiveProviderConfig(this.deps.db, userId);
    return config && this.view(config);
  }

  /** The saved (keyed) config a bring-your-own-key choice can switch back to, if any. */
  async saved(userId: number, choice: ByokChoice): Promise<ProviderView | undefined> {
    const config = await this.savedConfig(userId, choice);
    return config && this.view(config);
  }

  async reuse(userId: number, choice: ByokChoice): Promise<boolean> {
    const config = await this.savedConfig(userId, choice);
    if (!config) return false;
    return (await reactivateProviderConfig(this.deps.db, userId, config.id)) !== undefined;
  }

  /** Switches to a provider that carries no user key. */
  async activateKeyless(userId: number, kind: "server" | "claude-code"): Promise<void> {
    await activateProviderConfig(this.deps.db, userId, { kind }, this.deps.masterKey);
  }

  /**
   * Checks `apiKey` with a model listing and, only if the provider accepts it, stores it encrypted
   * as the active provider. The key is never logged, returned or kept anywhere else.
   */
  async submitKey(
    userId: number,
    choice: ByokChoice,
    apiKey: string,
    customBaseUrl?: string,
  ): Promise<{ ok: true } | { ok: false; notice: Notice }> {
    const kind = kindOf(choice);
    const baseUrl =
      choice === "custom"
        ? (customBaseUrl ?? null)
        : choice === "anthropic"
          ? null
          : OPENAI_PRESET_URLS[choice];
    if (choice === "custom" && !baseUrl) throw new Error("custom provider needs a base URL");

    const factories = this.deps.factories ?? defaultFactories;
    const candidate: LlmProvider =
      kind === "anthropic"
        ? factories.anthropic({ apiKey })
        : factories.openai({ apiKey, baseUrl });

    try {
      await candidate.listModels?.();
    } catch (error) {
      const status = error instanceof LlmProviderError ? error.status : undefined;
      this.deps.log.info("provider key rejected", { userId, kind, status });
      return { ok: false, notice: { key: "provider-key-rejected" } };
    }

    if (kind === "anthropic") {
      await activateProviderConfig(this.deps.db, userId, { kind, apiKey }, this.deps.masterKey);
    } else {
      await activateProviderConfig(
        this.deps.db,
        userId,
        { kind, apiKey, baseUrl },
        this.deps.masterKey,
      );
    }
    return { ok: true };
  }

  /** The models the active provider offers; empty when it cannot list them. */
  async listModels(userId: number): Promise<string[]> {
    try {
      const provider = await resolveProvider(this.deps, userId);
      return (await provider.listModels?.()) ?? [];
    } catch (error) {
      this.deps.log.warn("provider model listing failed", { userId, error });
      return [];
    }
  }

  /** Runs a tiny prompt through the active provider. Errors are told by i18n key, never verbatim. */
  async test(userId: number): Promise<Notice> {
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    try {
      const provider = await resolveProvider(this.deps, userId);
      await provider.complete({
        system: 'Reply with exactly this JSON and nothing else: {"ok": true}',
        messages: [{ role: "user", content: "ping" }],
        schema: z.object({ ok: z.boolean() }),
        tier: "fast",
        maxTokens: 32,
      });
      return { key: "provider-test-ok", vars: { ms: ms() } };
    } catch (error) {
      this.deps.log.warn("provider test failed", { userId, error });
      if (error instanceof ProviderUnavailableError) return { key: error.i18nKey };
      if (error instanceof LlmOutputError)
        return { key: "provider-test-bad-output", vars: { ms: ms() } };
      if (error instanceof LlmProviderError && error.status) {
        return { key: "provider-test-failed-status", vars: { status: error.status, ms: ms() } };
      }
      return { key: "provider-test-failed", vars: { ms: ms() } };
    }
  }

  private async savedConfig(
    userId: number,
    choice: ByokChoice,
  ): Promise<ProviderConfig | undefined> {
    const configs = await listProviderConfigs(this.deps.db, userId);
    return configs.find((config) => config.encryptedApiKey && choiceOf(config) === choice);
  }

  private view(config: ProviderConfig): ProviderView {
    return {
      kind: config.kind,
      choice: choiceOf(config),
      model: config.model,
      baseUrl: config.baseUrl,
      keyHint: providerKeyHint(config, this.deps.masterKey),
    };
  }
}
