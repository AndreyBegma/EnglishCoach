import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findUserByTelegramId, updateSettings } from "../../src/db/repositories/users";
import { cards, xpEvents } from "../../src/db/schema";
import { domainEvents } from "../../src/events/domain-events";
import { cardsBlock } from "../../src/progress/queries";
import { encodeVocabCallback, type VocabCallback } from "../../src/vocab/callbacks";
import { EVIDENCE, evidenceBits, requiredEvidence } from "../../src/vocab/mastery";
import { Scheduler } from "../../src/vocab/scheduler";
import type { VoiceOptions } from "../../src/voice";
import type { FetchLike } from "../../src/voice/engines";
import { createHarness, type Harness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { meaningOf, vocabSkills } from "./fake-llm";

const DAY = 86_400_000;
const OGG = new Uint8Array([79, 103, 103, 83, 0, 2, 0, 0]);
const KOKORO = "http://kokoro.test:8880";
const ALL = requiredEvidence({ earWaived: false });

describe.skipIf(!testServerUrl)("active mastery in Review (mocked Telegram, fake TTS)", () => {
  let database: Database;
  let cacheDir: string;
  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "coach-mastery-"));
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    await database.close();
  });

  const kokoro: FetchLike = async (url) => {
    if (url === `${KOKORO}/health`) return Response.json({ status: "healthy" });
    if (url === `${KOKORO}/v1/audio/speech`) return new Response(OGG);
    throw new Error(`unexpected fetch ${url}`);
  };
  const voiceOptions = (): VoiceOptions => ({
    fetch: kokoro,
    dir: cacheDir,
    tts: { TTS_URL: KOKORO, TTS_VOICE_US: "af_heart", TTS_VOICE_UK: "bf_emma" },
    stt: { STT_URL: undefined, STT_MODEL: "whisper" },
    prewarmIntervalMs: 0,
    sleep: async () => {},
  });

  let nextUser = 960_001;
  async function setup(voiceEnabled: boolean) {
    const telegramId = nextUser++;
    const llm = vocabSkills(database.db);
    const h = createHarness(database.db, {
      adminIds: [telegramId],
      skills: llm.skills,
      voice: voiceOptions(),
    });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    await updateSettings(database.db, user.id, {
      cefrLevel: "A2",
      timezone: "UTC",
      voiceEnabled,
    });
    return { h, telegramId, user, llm };
  }

  /** A word card in Review, due `dueDaysAgo` days ago, holding `evidence`. */
  function reviewed(
    userId: number,
    front: string,
    stability: number,
    dueDaysAgo: number,
    evidence: number,
  ) {
    const now = Date.now();
    return {
      ...new Scheduler().newCard(new Date(now - 90 * DAY)),
      userId,
      itemType: "word" as const,
      front,
      backJson: {
        translation: `${front}-translation`,
        examples: [{ en: `I ${front} it.`, translation: "x" }],
      },
      state: 2,
      reps: 6,
      stability,
      difficulty: 5,
      scheduledDays: Math.round(stability),
      lastReview: new Date(now - (dueDaysAgo + stability) * DAY),
      due: new Date(now - dueDaysAgo * DAY),
      evidence,
    };
  }

  const windowOf = (h: Harness, telegramId: number, id: number) => {
    const message = h.telegram.chat(telegramId).get(id);
    if (!message) throw new Error("the session window is gone");
    return message;
  };
  const press = (h: Harness, telegramId: number, window: number, callback: VocabCallback) =>
    h.press(telegramId, window, encodeVocabCallback(callback));

  async function startReview(h: Harness, telegramId: number, userId: number) {
    const hub = await getHub(database.db, userId);
    if (!hub) throw new Error("no hub");
    await h.press(
      telegramId,
      hub.messageId,
      encodeCallback({ type: "activity", activity: "review" }),
    );
    const window = [...h.telegram.chat(telegramId).values()].filter((m) => m.from === "bot").at(-1);
    if (!window) throw new Error("no review window");
    await press(h, telegramId, window.id, { op: "start" });
    return window.id;
  }

  const evidenceOf = async (ids: number[]) =>
    Object.fromEntries(
      (
        await database.db
          .select({ front: cards.front, evidence: cards.evidence, learnedAt: cards.learnedAt })
          .from(cards)
          .where(inArray(cards.id, ids))
      ).map((row) => [row.front, row]),
    );

  test("each mode asks for the missing evidence; the last one makes the card learned, once", async () => {
    const { h, telegramId, user, llm } = await setup(true);
    const seeded = await database.db
      .insert(cards)
      .values([
        reviewed(user.id, "quiet", 25, 5, 0),
        reviewed(user.id, "listen", 25, 4, EVIDENCE.text),
        reviewed(user.id, "borrow", 25, 3, EVIDENCE.text | EVIDENCE.ear),
        reviewed(user.id, "journey", 25, 2, EVIDENCE.text | EVIDENCE.ear | EVIDENCE.recall),
        reviewed(user.id, "decide", 30, 1, ALL & ~EVIDENCE.sentence),
      ])
      .returning();
    const ids = seeded.map((card) => card.id);
    const [quiet, listen, borrow, journey, decide] = seeded;
    if (!quiet || !listen || !borrow || !journey || !decide) throw new Error("cards not inserted");
    const learned: number[] = [];
    const off = domainEvents.on("card.learned", (event) => {
      if (event.userId === user.id) learned.push(event.cardId);
    });

    const window = await startReview(h, telegramId, user.id);

    // 1. No evidence → recognition in text.
    expect(windowOf(h, telegramId, window).text).toContain("<b>quiet</b>");
    await press(h, telegramId, window, { op: "choice", cardId: quiet.id, index: 0 });
    await press(h, telegramId, window, { op: "rate", cardId: quiet.id, rating: "good" });

    // 2. Recognised in text → listening: a tracked voice note, and a prompt that hides the word.
    const voices = h.telegram
      .callsOf("sendVoice")
      .filter((call) => Number(call.payload.chat_id) === telegramId);
    expect(voices).toHaveLength(1);
    const listening = windowOf(h, telegramId, window);
    expect(listening.text).toContain("Listen to the voice note");
    expect(listening.text).not.toContain("listen-translation");
    expect(listening.labels.flat()).toContain(meaningOf("listen"));
    await press(h, telegramId, window, { op: "choice", cardId: listen.id, index: 0 });
    await press(h, telegramId, window, { op: "rate", cardId: listen.id, rating: "good" });

    // 3. Text and ear → recall from the translation, typed exactly: recall and spelling.
    expect(windowOf(h, telegramId, window).text).toContain("Type the word.");
    expect(windowOf(h, telegramId, window).text).toContain(meaningOf("borrow"));
    await h.say(telegramId, "borrow");
    await press(h, telegramId, window, { op: "rate", cardId: borrow.id, rating: "good" });

    // 4. Recall but no spelling yet → a cloze gap.
    expect(windowOf(h, telegramId, window).text).toContain("I ___ it.");
    await h.say(telegramId, "journey");
    await press(h, telegramId, window, { op: "rate", cardId: journey.id, rating: "good" });

    // 5. Everything but a sentence on a stable card → own sentence, judged by vocab-check.
    llm.checks.push({
      verdict: "correct",
      accepted_as: "exact",
      suggested_rating: "good",
      feedback: "Nice sentence.",
    });
    await h.say(telegramId, "I decide to learn English every morning.");
    expect(llm.calls.check).toBe(1);
    await press(h, telegramId, window, { op: "rate", cardId: decide.id, rating: "good" });

    off();
    const after = await evidenceOf(ids);
    expect(after.quiet?.evidence).toBe(EVIDENCE.text);
    expect(after.listen?.evidence).toBe(EVIDENCE.text | EVIDENCE.ear);
    expect(after.borrow?.evidence).toBe(evidenceBits(["text", "ear", "recall", "spelling"]));
    expect(after.journey?.evidence).toBe(evidenceBits(["text", "ear", "recall", "spelling"]));
    expect(after.decide?.evidence).toBe(ALL);
    // Only the card with all five and a long interval is learned.
    expect(after.decide?.learnedAt).toBeInstanceOf(Date);
    for (const front of ["quiet", "listen", "borrow", "journey"]) {
      expect(after[front]?.learnedAt).toBeNull();
    }
    expect(learned).toEqual([decide.id]);
    const wordLearned = await database.db
      .select()
      .from(xpEvents)
      .where(and(eq(xpEvents.userId, user.id), eq(xpEvents.source, "word_learned")));
    expect(wordLearned.map((row) => row.meta)).toEqual([{ cardId: decide.id }]);

    // Progress counts only the learned card.
    const block = await cardsBlock(database.db, user.id, "UTC", new Date());
    expect(block.wordsLearned).toBe(1);
  });

  test("a right answer overridden to Again proves nothing", async () => {
    const { h, telegramId, user } = await setup(false);
    const [card] = await database.db
      .insert(cards)
      .values(reviewed(user.id, "quiet", 25, 1, 0))
      .returning();
    if (!card) throw new Error("card not inserted");
    const window = await startReview(h, telegramId, user.id);
    await press(h, telegramId, window, { op: "choice", cardId: card.id, index: 0 });
    await press(h, telegramId, window, { op: "rate", cardId: card.id, rating: "again" });
    expect((await evidenceOf([card.id])).quiet?.evidence).toBe(0);
  });

  test("voice off: listening is waived, never asked, and the card is learned without it", async () => {
    const { h, telegramId, user } = await setup(false);
    const [card] = await database.db
      .insert(cards)
      .values(reviewed(user.id, "journey", 30, 1, ALL & ~EVIDENCE.ear & ~EVIDENCE.spelling))
      .returning();
    if (!card) throw new Error("card not inserted");
    const window = await startReview(h, telegramId, user.id);
    // Ear is waived, so spelling is the missing evidence: a cloze, not a listening exercise.
    expect(h.telegram.callsOf("sendVoice")).toHaveLength(0);
    expect(windowOf(h, telegramId, window).text).toContain("I ___ it.");
    await h.say(telegramId, "journey");
    await press(h, telegramId, window, { op: "rate", cardId: card.id, rating: "good" });
    const after = (await evidenceOf([card.id])).journey;
    expect(after?.evidence).toBe(ALL & ~EVIDENCE.ear);
    expect(after?.learnedAt).toBeInstanceOf(Date);
    expect((await cardsBlock(database.db, user.id, "UTC", new Date())).wordsLearned).toBe(1);
  });
});
