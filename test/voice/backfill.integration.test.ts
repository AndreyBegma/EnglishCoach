import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "../../src/db/client";
import { getStatusBoard } from "../../src/db/repositories/voice";
import { words } from "../../src/db/schema";
import type { VoiceOptions } from "../../src/voice";
import type { FetchLike } from "../../src/voice/engines";
import { createHarness, type Harness, PIN_NOTICE } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const OGG = new Uint8Array([79, 103, 103, 83, 0, 2, 0, 0]);
const KOKORO = "http://kokoro.test:8880";
const STORAGE_CHAT = -100_901;
const LEMMAS = ["alpha", "bravo", "charlie"];

describe.skipIf(!testServerUrl)("voice backfill and its status board in the storage chat", () => {
  let database: Database;
  let cacheDir: string;
  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "coach-voice-backfill-"));
    database = await createTestDatabase(testServerUrl ?? "");
    await database.db.insert(words).values(
      LEMMAS.map((lemma, index) => ({
        lemma,
        pos: "noun",
        cefrLevel: "A2" as const,
        source: "owner_list",
        // Two owner examples; the third word has none.
        example: index < 2 ? `An example with ${lemma}.` : null,
        curriculumStage: 0,
        curriculumIndex: index + 1,
      })),
    );
  });
  afterAll(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    await database.close();
  });

  const engine = { failNext: 0, calls: [] as string[] };
  const kokoro: FetchLike = async (url, init) => {
    if (url === `${KOKORO}/health`) return Response.json({ status: "healthy" });
    if (url === `${KOKORO}/v1/audio/speech`) {
      engine.calls.push(String((JSON.parse(String(init?.body)) as { input: string }).input));
      if (engine.failNext > 0) {
        engine.failNext--;
        return new Response("busy", { status: 503 });
      }
      return new Response(OGG);
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  // Real time: `tts_audio.created_at` is the database's clock, which the counts read.
  let clock = Date.now();
  const minute = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  // Built in `beforeAll`, once the cache directory exists: without it the TTS would use data/tts.
  const options = (): VoiceOptions => ({
    fetch: kokoro,
    dir: cacheDir,
    tts: {
      TTS_URL: KOKORO,
      TTS_VOICE_US: "af_heart",
      TTS_VOICE_UK: "bf_emma",
      TTS_STORAGE_CHAT_ID: STORAGE_CHAT,
    },
    stt: { STT_URL: undefined, STT_MODEL: "whisper" },
    prewarmIntervalMs: 0,
    sleep: async () => {},
    now: () => clock,
  });

  let h: Harness;
  const telegramId = 961_001;
  beforeAll(async () => {
    h = createHarness(database.db, { adminIds: [telegramId], voice: options() });
    await h.say(telegramId, "/menu");
  });

  const storage = () => [...h.telegram.chat(STORAGE_CHAT).values()];
  const boardText = () => storage().find((m) => m.text.includes("Words:"))?.text ?? "";

  test("a run voices a slice, shows the board once, pinned, and deletes the pin notice", async () => {
    engine.failNext = 1;
    expect(await h.voice.backfill.run(3)).toBe(2);
    // Words first, in curriculum order; the first synthesis failed and is counted.
    expect(engine.calls.slice(0, 3)).toEqual(["alpha", "bravo", "charlie"]);

    const board = await getStatusBoard(database.db, STORAGE_CHAT);
    expect(board?.messageId).toBeDefined();
    expect(h.telegram.pinned.get(STORAGE_CHAT)).toBe(board?.messageId ?? -1);
    expect(
      h.telegram.callsOf("sendMessage").filter((c) => c.payload.chat_id === STORAGE_CHAT),
    ).toHaveLength(1);
    // The "pinned a message" notice was deleted by the bot's own cleanup.
    expect(storage().some((m) => m.text === PIN_NOTICE)).toBe(false);

    const text = boardText();
    expect(text).toContain("Words: 2 / 3 (66%) ▓▓▓▓▓▓░░░░");
    expect(text).toContain("Examples: 0 / 2 (0%)");
    expect(text).toContain("Remaining: 3");
    expect(text).toContain("Generated today: 2 · last 24 h: 2");
    expect(text).toContain("Failures today: 1");
    expect(text).toContain("Engine: kokoro · voice: af_heart");
    expect(text).toContain(`Updated: ${minute(clock)} UTC`);
    expect(board?.failures).toBe(1);
  });

  test("the next run edits the same message; a deleted board is re-created and re-pinned", async () => {
    clock += 15 * 60_000;
    const first = (await getStatusBoard(database.db, STORAGE_CHAT))?.messageId ?? -1;
    expect(await h.voice.backfill.run(10)).toBe(3);
    expect((await getStatusBoard(database.db, STORAGE_CHAT))?.messageId).toBe(first);
    expect(boardText()).toContain("Words: 3 / 3 (100%) ▓▓▓▓▓▓▓▓▓▓");
    expect(boardText()).toContain("Examples: 2 / 2 (100%)");
    expect(boardText()).toContain("ETA: done");
    expect(boardText()).toContain("Failures today: 1");

    h.telegram.chat(STORAGE_CHAT).delete(first);
    clock += 15 * 60_000;
    expect(await h.voice.backfill.run(10)).toBe(0);
    const second = (await getStatusBoard(database.db, STORAGE_CHAT))?.messageId;
    expect(second).not.toBe(first);
    expect(h.telegram.pinned.get(STORAGE_CHAT)).toBe(second ?? -1);
    expect(storage().filter((m) => m.text.includes("Words:"))).toHaveLength(1);
    expect(storage().some((m) => m.text === PIN_NOTICE)).toBe(false);
  });

  test("failures count per UTC day", async () => {
    const tomorrow = new Date(clock + 24 * 3_600_000).toISOString().slice(0, 10);
    clock = Date.parse(`${tomorrow}T01:00:00Z`);
    await h.voice.backfill.run(10);
    expect(boardText()).toContain("Failures today: 0");
    expect(boardText()).toContain(`Updated: ${tomorrow} 01:00 UTC`);
  });
});
