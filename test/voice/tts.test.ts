import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api } from "grammy";
import type { TtsAudioKey } from "../../src/db/repositories/voice";
import { createLogger } from "../../src/log";
import {
  type FetchLike,
  KokoroEngine,
  OpenAiSpeechEngine,
  type SpeechEngine,
  SpeechError,
} from "../../src/voice/engines";
import { type FileIdStore, speechTextHash, Tts } from "../../src/voice/tts";

const OGG = new Uint8Array([79, 103, 103, 83, 0, 2, 0, 0]);
const KOKORO = "http://tts.test:8880";
const OPENAI = "https://openai.test/v1";
const STORAGE_CHAT = -100_123;
const LEARNER_CHAT = 555;

type Call = { url: string; body?: Record<string, unknown> };

/** The two speech services. `kokoroUp: false` makes Kokoro refuse every request. */
function network() {
  const state = { kokoroUp: true, openaiStatus: 200, calls: [] as Call[] };
  const fetch: FetchLike = async (url, init) => {
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    state.calls.push({ url, body });
    if (url.startsWith(KOKORO)) {
      if (!state.kokoroUp) throw new TypeError("connection refused");
      if (url.endsWith("/health")) return Response.json({ status: "healthy" });
      if (url.endsWith("/v1/audio/speech")) return new Response(OGG);
    }
    if (url === `${OPENAI}/audio/speech`) {
      return state.openaiStatus === 200 ? new Response(OGG) : new Response("no", { status: 500 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const callsTo = (suffix: string) => state.calls.filter((call) => call.url.endsWith(suffix));
  const speechCalls = () => state.calls.filter((call) => call.url.includes("audio/speech"));
  return { state, fetch, callsTo, speechCalls };
}

/** A Telegram API that knows `sendVoice` and remembers each call. */
function telegram() {
  const sent: { chatId: number; file: unknown }[] = [];
  let next = 1;
  const deadIds = new Set<string>();
  const api = {
    sendVoice: async (chatId: number, file: unknown) => {
      if (typeof file === "string" && deadIds.has(file)) throw new Error("wrong file identifier");
      sent.push({ chatId, file });
      const id = next++;
      const fileId = typeof file === "string" ? file : `file-${id}`;
      return { message_id: id, chat: { id: chatId }, voice: { file_id: fileId } };
    },
  } as unknown as Api;
  return {
    api,
    sent,
    to: (chatId: number) => sent.filter((call) => call.chatId === chatId),
    kill: (fileId: string) => deadIds.add(fileId),
  };
}

function memoryFileIds() {
  const rows = new Map<string, string>();
  const id = (key: TtsAudioKey) => `${key.engine}|${key.voice}|${key.textHash}`;
  const store: FileIdStore = {
    find: async (key) => rows.get(id(key)),
    save: async (key, fileId) => {
      rows.set(id(key), fileId);
    },
  };
  return { store, rows };
}

const log = createLogger({ write: () => {} });

describe("Tts", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "coach-tts-unit-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function setup(
    options: { storage?: boolean; openaiKey?: boolean; kokoro?: boolean; now?: () => number } = {},
  ) {
    const { storage = true, openaiKey = true, kokoro = true } = options;
    const net = network();
    const tg = telegram();
    const fileIds = memoryFileIds();
    const engines: SpeechEngine[] = [];
    if (kokoro) {
      engines.push(
        new KokoroEngine({
          url: `${KOKORO}/`,
          voices: { us: "af_heart", uk: "bf_emma" },
          fetch: net.fetch,
          now: options.now,
        }),
      );
    }
    const credentialsFor: (number | undefined)[] = [];
    engines.push(
      new OpenAiSpeechEngine({
        credentials: async (userId) => {
          credentialsFor.push(userId);
          return openaiKey ? { apiKey: "sk-test", baseUrl: OPENAI } : undefined;
        },
        fetch: net.fetch,
      }),
    );
    const slept: number[] = [];
    const tts = new Tts({
      engines,
      fileIds: fileIds.store,
      storageChatId: storage ? STORAGE_CHAT : undefined,
      api: tg.api,
      log,
      dir,
      prewarmIntervalMs: 3_000,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    return { tts, net, tg, fileIds, slept, credentialsFor };
  }

  describe("engines", () => {
    test("Kokoro voices the text with the variant's voice, as Ogg/Opus, without a key", async () => {
      const { tts, net, tg } = setup();
      await tts.play(tg.api, LEARNER_CHAT, "  Decide ", "uk", 1);

      expect(net.speechCalls()).toEqual([
        {
          url: `${KOKORO}/v1/audio/speech`,
          body: {
            model: "kokoro",
            voice: "bf_emma",
            input: "Decide",
            response_format: "opus",
            stream: false,
          },
        },
      ]);
      expect(tg.to(LEARNER_CHAT)).toHaveLength(1);
    });

    test("US English picks the US voice", async () => {
      const { tts, net, tg } = setup();
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);
      expect(net.speechCalls()[0]?.body?.voice).toBe("af_heart");
    });

    test("with Kokoro down the OpenAI-compatible key is the fallback", async () => {
      const { tts, net, tg } = setup();
      net.state.kokoroUp = false;
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);

      expect(net.speechCalls()).toEqual([
        {
          url: `${OPENAI}/audio/speech`,
          body: { model: "tts-1", voice: "alloy", input: "decide", response_format: "opus" },
        },
      ]);
      expect(tg.to(LEARNER_CHAT)).toHaveLength(1);
    });

    test("a Kokoro synthesis failure falls through to OpenAI in the same play", async () => {
      const { tts, net, tg } = setup();
      await tts.available(1); // health is cached as good
      net.state.kokoroUp = false;
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);
      expect(net.callsTo("/audio/speech").map((call) => call.url)).toEqual([
        `${KOKORO}/v1/audio/speech`,
        `${OPENAI}/audio/speech`,
      ]);
    });

    test("when every engine fails, play throws SpeechError and nothing is sent", async () => {
      const { tts, net, tg } = setup();
      net.state.kokoroUp = false;
      net.state.openaiStatus = 500;
      await expect(tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1)).rejects.toBeInstanceOf(
        SpeechError,
      );
      expect(tg.sent).toHaveLength(0);
    });

    test("audio that is not Ogg/Opus is rejected", async () => {
      const engine = new KokoroEngine({
        url: KOKORO,
        voices: { us: "af_heart", uk: "bf_emma" },
        fetch: async () => new Response(new Uint8Array([73, 68, 51, 4])),
      });
      await expect(engine.synthesize("decide", "af_heart")).rejects.toThrow("not Ogg/Opus");
    });
  });

  describe("storage chat and file_id cache", () => {
    test("the first play uploads to the storage chat once and stores the file_id", async () => {
      const { tts, net, tg, fileIds } = setup();
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);

      expect(net.speechCalls()).toHaveLength(1);
      const uploads = tg.to(STORAGE_CHAT);
      expect(uploads).toHaveLength(1);
      expect(typeof uploads[0]?.file).not.toBe("string");
      const key = `kokoro|af_heart|${speechTextHash("decide")}`;
      expect(fileIds.rows.get(key)).toBe("file-1");
      // The learner gets the stored note by file_id: no second upload, never a forward.
      expect(tg.to(LEARNER_CHAT)).toEqual([{ chatId: LEARNER_CHAT, file: "file-1" }]);
    });

    test("the second play sends by file_id with no synthesis and no upload", async () => {
      const { tts, net, tg } = setup();
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);
      net.state.calls.length = 0;

      await tts.play(tg.api, LEARNER_CHAT + 1, "DECIDE", "us", 2);
      expect(net.state.calls).toHaveLength(0);
      expect(tg.to(STORAGE_CHAT)).toHaveLength(1);
      expect(tg.to(LEARNER_CHAT + 1)).toEqual([{ chatId: LEARNER_CHAT + 1, file: "file-1" }]);
    });

    test("a stored note plays even when no engine is available", async () => {
      const first = setup();
      await first.tts.play(first.tg.api, LEARNER_CHAT, "decide", "us", 1);

      const second = setup({ openaiKey: false });
      for (const [key, value] of first.fileIds.rows) second.fileIds.rows.set(key, value);
      second.net.state.kokoroUp = false;
      await second.tts.play(second.tg.api, LEARNER_CHAT, "decide", "us", 1);
      expect(second.net.speechCalls()).toHaveLength(0);
      expect(second.tg.to(LEARNER_CHAT)).toEqual([{ chatId: LEARNER_CHAT, file: "file-1" }]);
    });

    test("concurrent plays of one text share one synthesis and one upload", async () => {
      const { tts, net, tg } = setup();
      await Promise.all([
        tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1),
        tts.play(tg.api, LEARNER_CHAT + 1, "decide", "us", 2),
      ]);
      expect(net.speechCalls()).toHaveLength(1);
      expect(tg.to(STORAGE_CHAT)).toHaveLength(1);
    });

    test("without a storage chat the audio is cached on disk and uploaded with each send", async () => {
      const { tts, net, tg, fileIds } = setup({ storage: false });
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);

      expect(net.speechCalls()).toHaveLength(1);
      expect(tg.to(LEARNER_CHAT)).toHaveLength(2);
      expect(tg.sent.every((call) => typeof call.file !== "string")).toBe(true);
      expect(fileIds.rows.size).toBe(0);
    });

    test("a failed storage upload still voices the word, sent directly", async () => {
      const { tts, tg, fileIds } = setup();
      const realSend = tg.api.sendVoice;
      (tg.api as { sendVoice: unknown }).sendVoice = async (chatId: number, file: unknown) => {
        if (chatId === STORAGE_CHAT) throw new Error("bot is not a member of the chat");
        return realSend(chatId, file as string);
      };
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);
      expect(tg.to(LEARNER_CHAT)).toHaveLength(1);
      expect(typeof tg.to(LEARNER_CHAT)[0]?.file).not.toBe("string");
      expect(fileIds.rows.size).toBe(0);
    });

    test("a dead file_id is replaced by a fresh upload", async () => {
      const { tts, net, tg, fileIds } = setup();
      const key = { engine: "kokoro", voice: "af_heart", textHash: speechTextHash("decide") };
      await fileIds.store.save(key, "stale-id");
      tg.kill("stale-id");
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);

      expect(net.speechCalls()).toHaveLength(1);
      expect(fileIds.rows.get(`kokoro|af_heart|${key.textHash}`)).toBe("file-1");
      expect(tg.to(LEARNER_CHAT)).toEqual([{ chatId: LEARNER_CHAT, file: "file-1" }]);
    });
  });

  describe("available", () => {
    test("true with Kokoro up, even without a key", async () => {
      const { tts } = setup({ openaiKey: false });
      expect(await tts.available(1)).toBe(true);
    });

    test("true with Kokoro down and a key", async () => {
      const { tts, net } = setup();
      net.state.kokoroUp = false;
      expect(await tts.available(1)).toBe(true);
    });

    test("false when Kokoro is down and there is no key", async () => {
      const { tts, net } = setup({ openaiKey: false });
      net.state.kokoroUp = false;
      expect(await tts.available(1)).toBe(false);
    });

    test("false without Kokoro configured and without a key", async () => {
      const { tts, net } = setup({ kokoro: false, openaiKey: false });
      expect(await tts.available(1)).toBe(false);
      expect(net.state.calls).toHaveLength(0);
    });

    test("the health check is cached for 30 s", async () => {
      let now = 0;
      const { tts, net } = setup({ openaiKey: false, now: () => now });
      await tts.available(1);
      await Promise.all([tts.available(1), tts.available(2)]);
      expect(net.callsTo("/health")).toHaveLength(1);

      net.state.kokoroUp = false;
      now = 29_999;
      expect(await tts.available(1)).toBe(true);
      now = 30_000;
      expect(await tts.available(1)).toBe(false);
      expect(net.callsTo("/health")).toHaveLength(2);
    });
  });

  describe("prewarm", () => {
    test("uploads each new text once, pausing between uploads", async () => {
      const { tts, net, tg, slept } = setup();
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);
      net.state.calls.length = 0;

      await tts.prewarm(["decide", "borrow", "I borrowed a book.", "borrow", "  "], "us");
      expect(net.speechCalls().map((call) => call.body?.input)).toEqual([
        "borrow",
        "I borrowed a book.",
      ]);
      expect(tg.to(STORAGE_CHAT)).toHaveLength(3);
      expect(tg.to(LEARNER_CHAT)).toHaveLength(1);
      expect(slept).toEqual([3_000, 3_000]);

      await tts.prewarm(["borrow"], "us");
      expect(net.speechCalls()).toHaveLength(2);
    });

    test("runs for no learner: the fallback asks for server credentials only", async () => {
      const { tts, net, tg, credentialsFor } = setup();
      net.state.kokoroUp = false;
      await tts.prewarm(["decide"], "us");
      expect(credentialsFor.length).toBeGreaterThan(0);
      expect(credentialsFor.every((userId) => userId === undefined)).toBe(true);
      expect(net.callsTo(`${OPENAI}/audio/speech`)).toHaveLength(1);
      expect(tg.to(STORAGE_CHAT)).toHaveLength(1);
    });

    test("a failure is logged, not thrown, and the text can be prewarmed again", async () => {
      let now = 0;
      const { tts, net, tg } = setup({ openaiKey: false, now: () => now });
      net.state.kokoroUp = false;
      await tts.prewarm(["decide"], "us");
      expect(tg.sent).toHaveLength(0);

      net.state.kokoroUp = true;
      now = 60_000;
      await tts.prewarm(["decide"], "us");
      expect(tg.to(STORAGE_CHAT)).toHaveLength(1);
    });

    test("each variant has its own file_id cache entry; 🔊 reuses the matching one", async () => {
      const { tts, net, tg, fileIds } = setup();
      await tts.prewarm(["decide"], "us");
      await tts.prewarm(["decide"], "uk");
      expect(net.speechCalls().map((call) => call.body?.voice)).toEqual(["af_heart", "bf_emma"]);
      const hash = speechTextHash("decide");
      const usFileId = fileIds.rows.get(`kokoro|af_heart|${hash}`);
      const ukFileId = fileIds.rows.get(`kokoro|bf_emma|${hash}`);
      expect(usFileId).toBeDefined();
      expect(ukFileId).toBeDefined();
      expect(usFileId).not.toBe(ukFileId);

      await tts.play(tg.api, LEARNER_CHAT, "decide", "uk", 1);
      await tts.play(tg.api, LEARNER_CHAT, "decide", "us", 1);
      expect(net.speechCalls()).toHaveLength(2);
      expect(tg.to(LEARNER_CHAT).map((call) => call.file)).toEqual([ukFileId, usFileId]);
    });

    test("does nothing without a storage chat", async () => {
      const { tts, net } = setup({ storage: false });
      await tts.prewarm(["decide"], "us");
      expect(net.state.calls).toHaveLength(0);
    });
  });
});
