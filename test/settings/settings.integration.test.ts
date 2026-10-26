import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Callback, encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import {
  decryptProviderKey,
  getActiveProviderConfig,
  listProviderConfigs,
} from "../../src/db/repositories/providers";
import { findActiveSession } from "../../src/db/repositories/sessions";
import { findUserByTelegramId, getSettings } from "../../src/db/repositories/users";
import type { SettingsChanged } from "../../src/events/settings-events";
import { LlmProviderError } from "../../src/llm";
import { createHarness, TEST_MASTER_KEY } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const ANTHROPIC_KEY = "sk-ant-api03-settings-test-key-7c1d";
const OPENROUTER_KEY = "sk-or-v1-settings-test-key-55aa";
const CUSTOM_KEY = "custom-router-key-0123456789-beef";
const WRONG_KEY = "sk-ant-api03-wrong-key-000000000000";

describe.skipIf(!testServerUrl)("settings screens with a mocked Telegram API", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  let nextUser = 910_001;
  async function setup() {
    const telegramId = nextUser++;
    const h = createHarness(database.db, { adminIds: [telegramId] });
    h.llm.validKeys.add(ANTHROPIC_KEY).add(OPENROUTER_KEY).add(CUSTOM_KEY);
    await h.say(telegramId, "/start");
    const user = await findUserByTelegramId(database.db, telegramId);
    const hub = user && (await getHub(database.db, user.id));
    if (!user || !hub) throw new Error("user or hub not created");
    const events: SettingsChanged[] = [];
    h.settingsEvents.on("settings.changed", (event) => {
      events.push(event);
    });
    h.telegram.reset();

    const press = (callback: Callback) =>
      h.press(telegramId, hub.messageId, encodeCallback(callback));
    const hubText = () => h.telegram.chat(telegramId).get(hub.messageId)?.text ?? "";
    const hubLabels = () => h.telegram.chat(telegramId).get(hub.messageId)?.labels.flat() ?? [];
    const active = () => getActiveProviderConfig(database.db, user.id);
    const activeCount = async () =>
      (await listProviderConfigs(database.db, user.id)).filter((config) => config.isActive).length;
    const chatIds = () => [...h.telegram.chat(telegramId).keys()];
    const toast = () => h.telegram.callsOf("answerCallbackQuery").at(-1)?.payload.text;
    return {
      h,
      telegramId,
      user,
      hub,
      events,
      press,
      hubText,
      hubLabels,
      active,
      activeCount,
      chatIds,
      toast,
    };
  }

  test("an API key: deleted first, validated, stored encrypted, shown only masked", async () => {
    const s = await setup();
    await s.press({ type: "settings", page: "root" });
    await s.press({ type: "settings", page: "provider" });
    await s.press({ type: "provider", choice: "anthropic" });
    expect(s.hubText()).toContain("Paste your Anthropic key as a message");

    s.h.telegram.reset();
    const keyInChatAtValidation: boolean[] = [];
    s.h.llm.onListModels = () =>
      keyInChatAtValidation.push(
        [...s.h.telegram.chat(s.telegramId).values()].some((m) => m.text === ANTHROPIC_KEY),
      );
    const keyMessage = await s.h.say(s.telegramId, ANTHROPIC_KEY);
    expect(keyInChatAtValidation).toEqual([false]);

    // Before anything else is done with it, the message carrying the key is deleted.
    expect(s.h.telegram.calls[0]).toEqual({
      method: "deleteMessage",
      payload: { chat_id: s.telegramId, message_id: keyMessage },
    });
    expect(s.chatIds()).toEqual([s.hub.messageId]);

    const config = await s.active();
    expect(config?.kind).toBe("anthropic");
    expect(config?.encryptedApiKey?.toString("utf8")).not.toContain("settings-test");
    expect(config && decryptProviderKey(config, TEST_MASTER_KEY)).toBe(ANTHROPIC_KEY);
    // The candidate was checked with the typed key before it was stored.
    expect(s.h.llm.built.some((built) => built.apiKey === ANTHROPIC_KEY)).toBe(true);

    expect(s.hubText()).toContain("Key: sk-…7c1d");
    expect(s.hubText()).toContain("Key checked and saved.");
    expect(s.hubText()).not.toContain(ANTHROPIC_KEY);
    expect(JSON.stringify(s.h.telegram.calls)).not.toContain(ANTHROPIC_KEY);
    expect(s.h.logs.join("\n")).not.toContain(ANTHROPIC_KEY);
    expect(s.h.telegram.callsOf("sendMessage")).toHaveLength(0);
    expect(s.events).toEqual([{ userId: s.user.id, changed: ["provider"] }]);
  });

  test("a rejected key is deleted and nothing is stored; a good key afterwards still works", async () => {
    const s = await setup();
    await s.press({ type: "provider", choice: "anthropic" });

    const wrong = await s.h.say(s.telegramId, WRONG_KEY);
    expect(s.h.telegram.callsOf("deleteMessage")[0]?.payload.message_id).toBe(wrong);
    expect(await s.active()).toBeUndefined();
    expect(await listProviderConfigs(database.db, s.user.id)).toEqual([]);
    expect(s.hubText()).toContain("The provider rejected this key. Nothing was saved.");
    expect(JSON.stringify(s.h.telegram.calls)).not.toContain(WRONG_KEY);
    expect(s.h.logs.join("\n")).not.toContain(WRONG_KEY);
    expect(s.events).toEqual([]);

    // The hub is still asking; the next message is taken as the key.
    await s.h.say(s.telegramId, ANTHROPIC_KEY);
    expect((await s.active())?.kind).toBe("anthropic");
    expect(s.chatIds()).toEqual([s.hub.messageId]);
    expect(s.h.telegram.callsOf("sendMessage")).toHaveLength(0);
  });

  test("a rejected key leaves the previous provider active", async () => {
    const s = await setup();
    await s.press({ type: "provider", choice: "claude-code" });
    await s.press({ type: "provider", choice: "openrouter" });
    await s.h.say(s.telegramId, WRONG_KEY);
    expect((await s.active())?.kind).toBe("claude-code");
    expect(await s.activeCount()).toBe(1);
  });

  test("only one provider is active after switching back and forth", async () => {
    const s = await setup();
    const kinds: (string | undefined)[] = [];
    const record = async () => {
      expect(await s.activeCount()).toBe(1);
      const config = await s.active();
      kinds.push(config?.baseUrl ? `${config.kind} ${config.baseUrl}` : config?.kind);
    };

    await s.press({ type: "provider", choice: "server" });
    await record();
    await s.press({ type: "provider", choice: "anthropic" });
    await s.h.say(s.telegramId, ANTHROPIC_KEY);
    await record();
    await s.press({ type: "provider", choice: "openrouter" });
    await s.h.say(s.telegramId, OPENROUTER_KEY);
    await record();
    await s.press({ type: "provider", choice: "claude-code" });
    await record();

    // Anthropic again: its key is saved, so the bot offers it instead of asking.
    await s.press({ type: "provider", choice: "anthropic" });
    expect(s.hubText()).toContain("Anthropic key: a key is saved (sk-…7c1d).");
    await s.press({ type: "provider-reuse", choice: "anthropic" });
    await record();
    await s.press({ type: "provider", choice: "server" });
    await record();

    expect(kinds).toEqual([
      "server",
      "anthropic",
      "openai https://openrouter.ai/api/v1",
      "claude-code",
      "anthropic",
      "server",
    ]);
    expect(s.h.telegram.callsOf("sendMessage")).toHaveLength(0);
    expect(s.chatIds()).toEqual([s.hub.messageId]);
  });

  test("an OpenAI-compatible router: the base URL is checked, then the key", async () => {
    const s = await setup();
    await s.press({ type: "provider", choice: "custom" });
    expect(s.hubText()).toContain("Send the base URL");

    for (const bad of ["http://llm.example.com/v1", "https://169.254.169.254/v1"]) {
      await s.h.say(s.telegramId, bad);
      expect(s.hubText()).toContain("must start with https://");
    }
    await s.h.say(s.telegramId, "https://llm.example.com/v1/");
    expect(s.hubText()).toContain("Paste your OpenAI-compatible API key");
    await s.h.say(s.telegramId, CUSTOM_KEY);

    const config = await s.active();
    expect(config).toMatchObject({ kind: "openai", baseUrl: "https://llm.example.com/v1" });
    expect(s.h.llm.built.at(-1)).toMatchObject({
      apiKey: CUSTOM_KEY,
      baseUrl: "https://llm.example.com/v1",
    });
    expect(s.hubText()).toContain("OpenAI-compatible (llm.example.com)");
    expect(s.hubText()).toContain("Key: …beef");
    // Two bad URLs, the good one and the key: all deleted.
    expect(s.h.telegram.callsOf("deleteMessage")).toHaveLength(4);
    expect(s.chatIds()).toEqual([s.hub.messageId]);
  });

  test("the model picker lists models, pages, and takes a typed ID", async () => {
    const s = await setup();
    await s.press({ type: "provider", choice: "anthropic" });
    await s.h.say(s.telegramId, ANTHROPIC_KEY);
    s.h.llm.models = Array.from({ length: 10 }, (_, i) => `model-${i}`);

    await s.press({ type: "settings", page: "model" });
    expect(s.hubLabels()).toContain("model-7");
    expect(s.hubLabels()).not.toContain("model-8");
    expect(s.hubText()).toContain("Page 1 of 2");
    await s.press({ type: "settings", page: "model", n: 1 });
    expect(s.hubLabels()).toContain("model-9");

    await s.press({ type: "model", index: 9 });
    expect((await s.active())?.model).toBe("model-9");
    expect(s.hubText()).toContain("Model: model-9");

    await s.press({ type: "model", index: "default" });
    expect((await s.active())?.model).toBeNull();

    await s.press({ type: "input", input: "model" });
    const typed = await s.h.say(s.telegramId, "vendor/model-x:free");
    expect((await s.active())?.model).toBe("vendor/model-x:free");
    expect(s.h.telegram.chat(s.telegramId).has(typed)).toBe(false);

    // An index the cached list does not have is answered as outdated, never guessed.
    await s.press({ type: "model", index: 99 });
    expect(s.toast()).toBe("This menu is outdated.");
    expect((await s.active())?.model).toBe("vendor/model-x:free");
    expect(s.h.telegram.callsOf("sendMessage")).toHaveLength(0);
  });

  test("the server provider offers no model choice", async () => {
    const s = await setup();
    await s.press({ type: "settings", page: "provider" });
    expect(s.hubLabels()).not.toContain("Model");
    expect(s.hubLabels()).toContain("🧪 Test provider");
  });

  test("test provider reports OK with latency, and an error by status", async () => {
    const s = await setup();
    await s.press({ type: "provider-test" });
    expect(s.hubText()).toMatch(/Provider works \(\d+ ms\)/);

    s.h.llm.completeError = new LlmProviderError("anthropic", "anthropic request failed: 529", 529);
    await s.press({ type: "provider-test" });
    expect(s.hubText()).toMatch(/HTTP 529, \d+ ms/);
    expect(s.h.telegram.callsOf("sendMessage")).toHaveLength(0);
  });

  test("the runner is shown but cannot be chosen", async () => {
    const s = await setup();
    await s.press({ type: "settings", page: "provider" });
    expect(s.hubLabels()).toContain("Own machine — coming in v2");
    await s.press({ type: "provider", choice: "runner" });
    expect(s.toast()).toContain("coming in v2");
    expect(await s.active()).toBeUndefined();
  });

  test("picked values are saved, re-render the hub and emit settings.changed", async () => {
    const s = await setup();
    const changes: Callback[] = [
      { type: "set", change: { field: "explainLang", value: "ru" } },
      { type: "set", change: { field: "cefrLevel", value: "B1" } },
      { type: "set", change: { field: "wordsPerDay", value: 10 } },
      { type: "set", change: { field: "timezone", value: "Asia/Tokyo" } },
      { type: "set", change: { field: "morningTime", value: "07:00" } },
      { type: "set", change: { field: "eveningTime", value: "21:30" } },
      { type: "set", change: { field: "remindersEnabled", value: false } },
      { type: "set", change: { field: "voiceEnabled", value: true } },
    ];
    for (const change of changes) await s.press(change);

    expect(await getSettings(database.db, s.user.id)).toMatchObject({
      explainLang: "ru",
      cefrLevel: "B1",
      wordsPerDay: 10,
      timezone: "Asia/Tokyo",
      morningTime: "07:00:00",
      eveningTime: "21:30:00",
      remindersEnabled: false,
      voiceEnabled: true,
    });
    const text = s.hubText();
    for (const line of [
      "Explanations in: Русский",
      "Level: B1",
      "Words per day: 10",
      "Time zone: Asia/Tokyo",
      "Morning 07:00 · Evening 21:30",
      "Reminders: off",
      "Voice: on",
    ]) {
      expect(text).toContain(line);
    }
    expect(s.events.map((event) => event.changed)).toEqual([
      ["explainLang"],
      ["cefrLevel"],
      ["wordsPerDay"],
      ["timezone"],
      ["morningTime"],
      ["eveningTime"],
      ["remindersEnabled"],
      ["voiceEnabled"],
    ]);
    expect(s.h.telegram.callsOf("sendMessage")).toHaveLength(0);
    expect(s.h.telegram.callsOf("editMessageText")).toHaveLength(changes.length);
  });

  test("every settings page opens by editing the hub, in every language", async () => {
    const s = await setup();
    const pages = [
      "root",
      "lang",
      "explain",
      "level",
      "words",
      "timezone",
      "morning",
      "evening",
      "provider",
    ] as const;
    for (const lang of ["ru", "uk", "en"] as const) {
      await s.press({ type: "lang", lang });
      for (const page of pages) await s.press({ type: "settings", page });
      await s.press({ type: "settings", page: "morning", n: 1 });
      await s.press({ type: "input", input: "timezone" });
      await s.press({ type: "input-cancel" });
    }
    expect(s.hubText()).toContain("Your time zone");
    expect(s.h.telegram.callsOf("sendMessage")).toHaveLength(0);
    expect(s.chatIds()).toEqual([s.hub.messageId]);
  });

  test("a time zone is typed or taken from a shared location", async () => {
    const s = await setup();
    await s.press({ type: "input", input: "timezone" });
    await s.h.say(s.telegramId, "Mars/Olympus");
    expect(s.hubText()).toContain("Unknown time zone");
    await s.h.say(s.telegramId, "asia/tokyo");
    expect((await getSettings(database.db, s.user.id))?.timezone).toBe("Asia/Tokyo");

    await s.press({ type: "input", input: "timezone" });
    const shared = await s.h.shareLocation(s.telegramId, 51.5, -0.12);
    expect((await getSettings(database.db, s.user.id))?.timezone).toBe("Europe/London");
    expect(s.h.telegram.chat(s.telegramId).has(shared)).toBe(false);
    expect(s.chatIds()).toEqual([s.hub.messageId]);
  });

  test("a key typed during a learning session goes to settings, not to the session", async () => {
    const s = await setup();
    await s.h.say(s.telegramId, "/demo");
    expect(await findActiveSession(database.db, s.user.id)).toBeDefined();
    s.h.telegram.reset();

    await s.press({ type: "provider", choice: "anthropic" });
    await s.h.say(s.telegramId, ANTHROPIC_KEY);
    expect((await s.active())?.kind).toBe("anthropic");
    // The demo session echoes every message; it saw nothing.
    expect(s.h.telegram.callsOf("sendMessage")).toHaveLength(0);
    expect(JSON.stringify(s.h.telegram.calls)).not.toContain(ANTHROPIC_KEY);
  });

  test("leaving the prompt — another button or a command — stops waiting for a key", async () => {
    const s = await setup();
    await s.press({ type: "provider", choice: "anthropic" });
    await s.press({ type: "settings", page: "root" });
    const afterButton = await s.h.say(s.telegramId, ANTHROPIC_KEY.replace("7c1d", "aaaa"));
    expect(s.h.telegram.chat(s.telegramId).has(afterButton)).toBe(true);

    await s.press({ type: "provider", choice: "anthropic" });
    await s.h.say(s.telegramId, "/menu");
    const afterCommand = await s.h.say(s.telegramId, "hello");
    expect(s.h.telegram.chat(s.telegramId).has(afterCommand)).toBe(true);

    expect(await listProviderConfigs(database.db, s.user.id)).toEqual([]);
  });

  test("settings buttons on an old hub are outdated", async () => {
    const s = await setup();
    await s.h.say(s.telegramId, "/menu");
    s.h.telegram.reset();
    await s.press({ type: "provider", choice: "server" });
    expect(s.toast()).toBe("This menu is outdated.");
    expect(await s.active()).toBeUndefined();
  });
});
