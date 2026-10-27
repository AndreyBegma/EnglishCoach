import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findUserByTelegramId, updateSettings } from "../../src/db/repositories/users";
import { cards, ttsAudio, words } from "../../src/db/schema";
import { createLogger } from "../../src/log";
import { loadSkillRegistry } from "../../src/skills";
import type { VoiceOptions } from "../../src/voice";
import { encodeVoiceCallback } from "../../src/voice/callbacks";
import type { FetchLike } from "../../src/voice/engines";
import { speechTextHash } from "../../src/voice/tts";
import { WordEnricher } from "../../src/words/enrichment";
import { createHarness, type Harness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { vocabSkills } from "../vocab/fake-llm";

const OGG = new Uint8Array([79, 103, 103, 83, 0, 2, 0, 0]);
const KOKORO = "http://kokoro.test:8880";
const STORAGE_CHAT = -100_900;
const LEMMAS = ["decide", "borrow"];

describe.skipIf(!testServerUrl)("🔊 on word cards (fake TTS, mocked Telegram)", () => {
  let database: Database;
  let cacheDir: string;
  const registry = loadSkillRegistry();
  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "coach-card-voice-"));
    database = await createTestDatabase(testServerUrl ?? "");
    await database.db.insert(words).values(
      LEMMAS.map((lemma, index) => ({
        lemma,
        pos: "verb",
        cefrLevel: "A2" as const,
        source: "owner_list",
        curriculumStage: 0,
        curriculumIndex: index + 1,
      })),
    );
  });
  afterAll(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    await database.close();
  });

  /** Kokoro behind Kokoro-FastAPI: every synthesis is recorded with its text and voice. */
  const speech: { input: unknown; voice: unknown }[] = [];
  const kokoro: FetchLike = async (url, init) => {
    if (url === `${KOKORO}/health`) return Response.json({ status: "healthy" });
    if (url === `${KOKORO}/v1/audio/speech`) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      speech.push({ input: body.input, voice: body.voice });
      return new Response(OGG);
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  function voiceOptions(withTts: boolean): VoiceOptions {
    return {
      fetch: kokoro,
      dir: cacheDir,
      tts: {
        TTS_URL: withTts ? KOKORO : undefined,
        TTS_VOICE_US: "af_heart",
        TTS_VOICE_UK: "bf_emma",
        TTS_STORAGE_CHAT_ID: withTts ? STORAGE_CHAT : undefined,
      },
      stt: { STT_URL: undefined, STT_MODEL: "whisper" },
      prewarmIntervalMs: 0,
      sleep: async () => {},
    };
  }

  let nextUser = 951_001;
  /** A learner with no OpenAI-compatible key: only the local engine can speak. */
  async function setup(withTts: boolean) {
    const telegramId = nextUser++;
    const llm = vocabSkills(database.db);
    const h = createHarness(database.db, {
      adminIds: [telegramId],
      skills: llm.skills,
      voice: voiceOptions(withTts),
    });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    await updateSettings(database.db, user.id, {
      cefrLevel: "A2",
      wordsPerDay: 2,
      timezone: "UTC",
      voiceEnabled: true,
      englishVariant: "uk",
    });
    return { h, telegramId, user, llm };
  }

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
    const message = [...h.telegram.chat(telegramId).values()]
      .filter((m) => m.from === "bot")
      .at(-1);
    if (!message) throw new Error("no card message");
    return { card, message };
  }

  const voicesTo = (h: Harness, chatId: number) =>
    h.telegram.callsOf("sendVoice").filter((call) => Number(call.payload.chat_id) === chatId);

  test("no TTS: the card has no 🔊 button", async () => {
    const { h, telegramId, user } = await setup(false);
    const { card, message } = await openLearn(h, telegramId, user.id);
    expect(message.buttons.flat()).not.toContain(
      encodeVoiceCallback({ op: "speak", cardId: card.id }),
    );
    expect(message.buttons.flat().some((data) => data.includes(":vo:"))).toBe(false);
  });

  test("the prefetch warms the cache; 🔊 then sends the stored voice by file_id", async () => {
    const { h, telegramId, user, llm } = await setup(true);
    const enricher = new WordEnricher({
      db: database.db,
      registry,
      provider: () => llm.provider,
      log: createLogger({ level: "error" }),
      adminTelegramIds: [telegramId],
      speech: h.voice.tts,
    });
    await enricher.prefetchUser(user.id);
    // Prewarm runs behind the job; an empty call resolves once the queue before it is done.
    await h.voice.tts.prewarm([], "uk");

    // Both words and their first examples, in the learner's variant, uploaded to the storage chat.
    expect(speech).toHaveLength(4);
    expect(speech.every((call) => call.voice === "bf_emma")).toBe(true);
    expect(speech.map((call) => call.input)).toEqual([
      "decide",
      "Model sentence one with decide.",
      "borrow",
      "Model sentence one with borrow.",
    ]);
    expect(voicesTo(h, STORAGE_CHAT)).toHaveLength(4);
    const stored = await database.db.select().from(ttsAudio).where(eq(ttsAudio.voice, "bf_emma"));
    expect(stored).toHaveLength(4);

    const { card, message } = await openLearn(h, telegramId, user.id);
    const word = encodeVoiceCallback({ op: "speak", cardId: card.id });
    const example = encodeVoiceCallback({ op: "speak", cardId: card.id, target: "example" });
    expect(message.buttons.flat()).toEqual(expect.arrayContaining([word, example]));
    expect(message.labels.flat()).toEqual(expect.arrayContaining(["🔊 Listen", "🔊 Example"]));

    await h.press(telegramId, message.id, word);
    await h.press(telegramId, message.id, example);
    const sent = voicesTo(h, telegramId);
    expect(sent).toHaveLength(2);
    // By file_id: no new synthesis, no upload.
    expect(sent.every((call) => typeof call.payload.voice === "string")).toBe(true);
    expect(speech).toHaveLength(4);
    const fileIdOf = async (text: string) => {
      const rows = await database.db.select().from(ttsAudio).where(eq(ttsAudio.voice, "bf_emma"));
      return rows.find((row) => row.textHash === speechTextHash(text))?.telegramFileId;
    };
    expect(sent.map((call) => call.payload.voice)).toEqual([
      await fileIdOf("decide"),
      await fileIdOf("Model sentence one with decide."),
    ]);
    // The card stays as it was: its keyboard is not taken by the 🔊 tap.
    expect(h.telegram.chat(telegramId).get(message.id)?.buttons.flat()).toContain(word);
  });

  test("a 🔊 of a card no longer on screen is refused as already answered", async () => {
    const { h, telegramId, user } = await setup(true);
    const { card, message } = await openLearn(h, telegramId, user.id);
    const word = encodeVoiceCallback({ op: "speak", cardId: card.id });
    expect(message.buttons.flat()).toContain(word);
    await h.press(telegramId, message.id, `1:v:g:${card.id}`);
    const before = voicesTo(h, telegramId).length;

    await h.press(telegramId, message.id, word);
    expect(voicesTo(h, telegramId)).toHaveLength(before);
    expect(String(h.telegram.callsOf("answerCallbackQuery").at(-1)?.payload.text)).toContain(
      "already answered",
    );
  });
});
