import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { activateProviderConfig } from "../../src/db/repositories/providers";
import { findActiveSession } from "../../src/db/repositories/sessions";
import { findUserByTelegramId, updateSettings } from "../../src/db/repositories/users";
import { cards, words } from "../../src/db/schema";
import { MAX_VOICE_SECONDS } from "../../src/voice";
import { encodeVoiceCallback } from "../../src/voice/callbacks";
import { resolveAudioCredentials } from "../../src/voice/credentials";
import { createHarness, type Harness, TEST_MASTER_KEY } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { vocabSkills } from "../vocab/fake-llm";

const AUDIO = new Uint8Array([79, 103, 103, 83, 1, 2, 3]);
const USER_BASE_URL = "https://stt.example/v1";

type Fetched = { url: string; auth: string | null };

describe.skipIf(!testServerUrl)(
  "voice with mocked Telegram and OpenAI-compatible audio APIs",
  () => {
    let database: Database;
    let cacheDir: string;
    beforeAll(async () => {
      cacheDir = await mkdtemp(join(tmpdir(), "coach-tts-"));
      process.env.TTS_CACHE_DIR = cacheDir;
      database = await createTestDatabase(testServerUrl ?? "");
      await database.db.insert(words).values(
        ["decide", "borrow"].map((lemma, rank) => ({
          lemma,
          pos: "verb",
          cefrLevel: "A2" as const,
          frequencyRank: rank + 1,
          source: "test",
        })),
      );
    });
    afterAll(async () => {
      network.mockRestore();
      Reflect.deleteProperty(process.env, "TTS_CACHE_DIR");
      await rm(cacheDir, { recursive: true, force: true });
      await database.close();
    });

    const fetched: Fetched[] = [];
    let transcript = "I decided to go";
    let sttStatus = 200;
    afterEach(() => {
      fetched.length = 0;
      transcript = "I decided to go";
      sttStatus = 200;
    });

    /** The network: Telegram file downloads and the two audio endpoints. */
    const network = spyOn(globalThis, "fetch");
    network.mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      fetched.push({ url, auth: headers.get("authorization") });
      if (url.includes("/file/bot")) return new Response(AUDIO);
      if (url.endsWith("/audio/transcriptions")) {
        return sttStatus === 200
          ? Response.json({ text: transcript })
          : new Response("nope", { status: sttStatus });
      }
      if (url.endsWith("/audio/speech")) return new Response(AUDIO);
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch);

    const callsTo = (suffix: string) => fetched.filter((call) => call.url.endsWith(suffix));

    let nextUser = 920_001;
    async function setup(options: { voice?: boolean; key?: boolean } = {}) {
      const { voice = true, key = true } = options;
      const telegramId = nextUser++;
      const llm = vocabSkills(database.db);
      const h = createHarness(database.db, { adminIds: [telegramId], skills: llm.skills });

      // The fake Telegram knows neither getFile nor sendVoice; answer them in front of it.
      let voiceId = 90_000;
      h.bot.api.config.use(async (prev, method, payload, signal) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        if (method === "getFile") {
          return {
            ok: true,
            result: { file_id: String(p.file_id), file_path: "voice/file.oga" },
          } as never;
        }
        if (method === "sendVoice") {
          const id = voiceId++;
          h.telegram.calls.push({ method, payload: p });
          h.telegram.chat(Number(p.chat_id)).set(id, {
            id,
            from: "bot",
            text: "[voice]",
            buttons: [],
            labels: [],
          });
          return {
            ok: true,
            result: { message_id: id, date: 0, chat: { id: Number(p.chat_id), type: "private" } },
          } as never;
        }
        return prev(method, payload, signal);
      });

      await h.say(telegramId, "/menu");
      const user = await findUserByTelegramId(database.db, telegramId);
      if (!user) throw new Error("user not created");
      await updateSettings(database.db, user.id, {
        cefrLevel: "A2",
        wordsPerDay: 2,
        timezone: "UTC",
        voiceEnabled: voice,
      });
      if (key) {
        await activateProviderConfig(
          database.db,
          user.id,
          { kind: "openai", apiKey: "sk-user-secret-key", baseUrl: USER_BASE_URL },
          TEST_MASTER_KEY,
        );
      }
      return { h, telegramId, user };
    }

    let updateId = 5_000_000;
    /** The user sends a voice message of `duration` seconds. */
    async function sayVoice(h: Harness, telegramId: number, duration = 5) {
      const id = h.telegram.userMessage(telegramId, "");
      await h.bot.handleUpdate({
        update_id: updateId++,
        message: {
          message_id: id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: telegramId, type: "private", first_name: `User${telegramId}` },
          from: {
            id: telegramId,
            is_bot: false,
            first_name: `User${telegramId}`,
            language_code: "en",
          },
          voice: { file_id: "voice-1", file_unique_id: "u1", duration, mime_type: "audio/ogg" },
        },
      } as never);
      return id;
    }

    const botTexts = (h: Harness, telegramId: number) =>
      [...h.telegram.chat(telegramId).values()].filter((m) => m.from === "bot").map((m) => m.text);
    const last = (h: Harness, telegramId: number) => {
      const message = [...h.telegram.chat(telegramId).values()]
        .filter((m) => m.from === "bot")
        .at(-1);
      if (!message) throw new Error("no bot message");
      return message;
    };

    async function expectOnlyHub(h: Harness, telegramId: number, userId: number) {
      const hub = await getHub(database.db, userId);
      expect([...h.telegram.chat(telegramId).keys()]).toEqual([hub?.messageId ?? -1]);
      expect(await findActiveSession(database.db, userId)).toBeUndefined();
    }

    describe("speech to text", () => {
      test("a transcribed voice message reaches the session handler as text, and is cleaned up", async () => {
        const { h, telegramId, user } = await setup();
        await h.say(telegramId, "/demo");

        await sayVoice(h, telegramId);
        // The same handler that serves typed text echoes the transcript.
        expect(botTexts(h, telegramId)).toContain("🎤 I decided to go");
        expect(last(h, telegramId).text).toContain("I decided to go");
        expect(last(h, telegramId).text).not.toBe("🎤 I decided to go");

        // The user's own key and base URL were used, once.
        expect(callsTo("/audio/transcriptions")).toEqual([
          { url: `${USER_BASE_URL}/audio/transcriptions`, auth: "Bearer sk-user-secret-key" },
        ]);
        expect(JSON.stringify(h.logs)).not.toContain("sk-user-secret-key");

        // Two more messages finish the demo session: voice messages and transcripts are tracked.
        await sayVoice(h, telegramId);
        await sayVoice(h, telegramId);
        await expectOnlyHub(h, telegramId, user.id);
      });

      test("a message longer than 60 s is refused in the learner's language; the session goes on", async () => {
        const { h, telegramId, user } = await setup();
        await h.say(telegramId, "/demo");
        await sayVoice(h, telegramId, MAX_VOICE_SECONDS + 1);

        expect(last(h, telegramId).text).toContain("too long");
        expect(last(h, telegramId).text).toContain("60 seconds");
        expect(fetched).toEqual([]);
        expect(await findActiveSession(database.db, user.id)).toBeDefined();

        await h.say(telegramId, "typed instead");
        expect(last(h, telegramId).text).toContain("typed instead");
      });

      test("without any OpenAI-compatible key the bot explains and the session survives", async () => {
        const { h, telegramId, user } = await setup({ key: false });
        await h.say(telegramId, "/demo");
        await sayVoice(h, telegramId);

        expect(last(h, telegramId).text).toContain("OpenAI-compatible API key");
        expect(fetched).toEqual([]);
        expect(await findActiveSession(database.db, user.id)).toBeDefined();

        await h.say(telegramId, "typed instead");
        expect(last(h, telegramId).text).toContain("typed instead");
      });

      test("the explanation is localized", async () => {
        const { h, telegramId, user } = await setup({ key: false });
        await updateSettings(database.db, user.id, { uiLang: "ru" });
        await h.say(telegramId, "/demo");
        await sayVoice(h, telegramId);
        expect(last(h, telegramId).text).toContain("OpenAI-совместимый API-ключ");
      });

      test("a failing transcription API is reported without ending the session", async () => {
        const { h, telegramId, user } = await setup();
        await h.say(telegramId, "/demo");
        sttStatus = 500;
        await sayVoice(h, telegramId);

        expect(last(h, telegramId).text).toContain("could not transcribe");
        expect(await findActiveSession(database.db, user.id)).toBeDefined();
      });

      test("an empty transcript is not handed to the session", async () => {
        const { h, telegramId } = await setup();
        await h.say(telegramId, "/demo");
        transcript = "  ";
        await sayVoice(h, telegramId);
        expect(last(h, telegramId).text).toContain("could not hear any words");
      });

      test("with voice off the message is left alone and nothing is sent to the API", async () => {
        const { h, telegramId } = await setup({ voice: false });
        await h.say(telegramId, "/demo");
        await sayVoice(h, telegramId);

        expect(fetched).toEqual([]);
        expect(botTexts(h, telegramId).some((text) => text.startsWith("🎤"))).toBe(false);
      });
    });

    describe("text to speech", () => {
      async function openLearn(h: Harness, telegramId: number, userId: number) {
        const hub = await getHub(database.db, userId);
        if (!hub) throw new Error("no hub");
        await h.press(
          telegramId,
          hub.messageId,
          encodeCallback({ type: "activity", activity: "learn" }),
        );
        const [card] = await database.db
          .select()
          .from(cards)
          .where(and(eq(cards.userId, userId), eq(cards.front, "decide")));
        if (!card) throw new Error("no card");
        return card;
      }

      test("🔊 sends a voice note; the second request is served from the cache", async () => {
        const { h, telegramId, user } = await setup();
        const card = await openLearn(h, telegramId, user.id);
        const message = last(h, telegramId);
        const data = encodeVoiceCallback({ op: "speak", cardId: card.id });
        expect(message.buttons.flat()).toContain(data);
        expect(message.labels.flat()).toContain("🔊 Listen");

        await h.press(telegramId, message.id, data);
        expect(h.telegram.callsOf("sendVoice")).toHaveLength(1);
        expect(callsTo("/audio/speech")).toEqual([
          { url: `${USER_BASE_URL}/audio/speech`, auth: "Bearer sk-user-secret-key" },
        ]);
        expect(readdirSync(join(cacheDir, "alloy"))).toHaveLength(1);

        await h.press(telegramId, message.id, data);
        expect(h.telegram.callsOf("sendVoice")).toHaveLength(2);
        expect(callsTo("/audio/speech")).toHaveLength(1);

        // The voice notes are session messages: ending the session deletes them.
        await h.press(telegramId, message.id, "1:v:f");
        await expectOnlyHub(h, telegramId, user.id);
      });

      test("a cached word is voiced even for a learner without a key", async () => {
        const first = await setup();
        const card = await openLearn(first.h, first.telegramId, first.user.id);
        await first.h.press(
          first.telegramId,
          last(first.h, first.telegramId).id,
          encodeVoiceCallback({ op: "speak", cardId: card.id }),
        );
        fetched.length = 0;

        const second = await setup({ key: false });
        const mine = await openLearn(second.h, second.telegramId, second.user.id);
        await second.h.press(
          second.telegramId,
          last(second.h, second.telegramId).id,
          encodeVoiceCallback({ op: "speak", cardId: mine.id }),
        );
        expect(second.h.telegram.callsOf("sendVoice")).toHaveLength(1);
        expect(callsTo("/audio/speech")).toHaveLength(0);
      });

      test("without a key and nothing cached the learner is told, and no note is sent", async () => {
        const { h, telegramId, user } = await setup({ key: false });
        const card = await openLearn(h, telegramId, user.id);
        // "decide" may already be cached by an earlier test; use the other word's card.
        await h.press(telegramId, last(h, telegramId).id, `1:v:g:${card.id}`);
        await h.press(telegramId, last(h, telegramId).id, `1:v:c:${card.id}:0`);
        const borrow = await database.db
          .select()
          .from(cards)
          .where(and(eq(cards.userId, user.id), eq(cards.front, "borrow")));
        const target = borrow[0];
        if (!target) throw new Error("no second card");

        await h.press(
          telegramId,
          last(h, telegramId).id,
          encodeVoiceCallback({ op: "speak", cardId: target.id }),
        );
        expect(h.telegram.callsOf("sendVoice")).toHaveLength(0);
        expect(h.telegram.callsOf("answerCallbackQuery").at(-1)?.payload).toMatchObject({
          show_alert: true,
        });
        expect(String(h.telegram.callsOf("answerCallbackQuery").at(-1)?.payload.text)).toContain(
          "OpenAI-compatible API key",
        );
        expect(await findActiveSession(database.db, user.id)).toBeDefined();
      });

      test("with voice off there is no 🔊 button and a stale one is refused", async () => {
        const { h, telegramId, user } = await setup({ voice: false });
        const card = await openLearn(h, telegramId, user.id);
        const message = last(h, telegramId);
        const data = encodeVoiceCallback({ op: "speak", cardId: card.id });
        expect(message.buttons.flat()).not.toContain(data);

        await h.press(telegramId, message.id, data);
        expect(h.telegram.callsOf("sendVoice")).toHaveLength(0);
        expect(String(h.telegram.callsOf("answerCallbackQuery").at(-1)?.payload.text)).toContain(
          "Voice is off",
        );
      });
    });

    describe("credentials", () => {
      test("the user's OpenAI-compatible key wins over the server key; the server key is the fallback", async () => {
        const { user } = await setup();
        const env = {
          SERVER_OPENAI_API_KEY: "sk-server",
          SERVER_OPENAI_BASE_URL: "https://srv/v1",
        };
        const deps = { db: database.db, env, masterKey: TEST_MASTER_KEY };
        expect(await resolveAudioCredentials(deps, user.id)).toEqual({
          apiKey: "sk-user-secret-key",
          baseUrl: USER_BASE_URL,
        });

        const { user: other } = await setup({ key: false });
        expect(await resolveAudioCredentials(deps, other.id)).toEqual({
          apiKey: "sk-server",
          baseUrl: "https://srv/v1",
        });
        expect(await resolveAudioCredentials({ ...deps, env: {} }, other.id)).toBeUndefined();
      });
    });

    test("the cache directory is only touched by the temporary test directory", () => {
      expect(existsSync(join(process.cwd(), "data", "tts"))).toBe(false);
    });
  },
);
