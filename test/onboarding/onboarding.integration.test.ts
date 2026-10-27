import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Callback, encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { activateProviderConfig } from "../../src/db/repositories/providers";
import { findActiveSession } from "../../src/db/repositories/sessions";
import { findUserByTelegramId, getSettings, updateSettings } from "../../src/db/repositories/users";
import type { SettingsChanged } from "../../src/events/settings-events";
import { getLevels, SEEDED_UNCERTAINTY, seedLevels } from "../../src/levels";
import type { CompletionRequest, LlmProvider } from "../../src/llm";
import { encodeOnboardingCallback, type OnboardingCallback } from "../../src/onboarding/callbacks";
import { learnerContextFromDb, loadSkillRegistry, SkillRunner } from "../../src/skills";
import { createHarness, TEST_MASTER_KEY } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const SKILLS = ["grammar", "vocabulary", "reading", "listening", "writing", "speaking"] as const;
const AUDIO = new Uint8Array([79, 103, 103, 83, 1, 2, 3]);
const SPOKEN = "on weekends I usually meet my friends and we go to the park or the cinema together";
const WRITTEN =
  "I would like to visit Japan one day. I am interested in its culture and food. I want to see the temples in Kyoto.";

type Task = Record<string, unknown>;

/** The `<task>` JSON of a skill call: what the server asked the model for. */
function taskOf(request: CompletionRequest<unknown>): Task {
  const content = String(request.messages.at(-1)?.content ?? "");
  const json = content.split("<task>\n")[1]?.split("\n</task>")[0];
  if (!json) throw new Error("skill call without a task");
  return JSON.parse(json);
}

/**
 * Plays the model. Items name their level in the question (`[B2] …`) and always have option B
 * right, so the test can answer as a learner of a given level. Rubrics grade `rubricLevel`.
 */
class ScriptedPlacement {
  /** The next calls fail like a broken provider. */
  failNext = 0;
  rubricLevel = "B2";
  readonly tasks: Task[] = [];

  readonly provider: LlmProvider = {
    kind: "anthropic",
    complete: async (request) => {
      if (this.failNext > 0) {
        this.failNext--;
        throw new Error("provider is down");
      }
      const task = taskOf(request as CompletionRequest<unknown>);
      this.tasks.push(task);
      const n = this.tasks.length;
      if ("learner_answer" in task) {
        return {
          data: request.schema.parse({
            on_task: true,
            criteria: { task: 2, coherence: 2, range: 2, accuracy: 2 },
            level: this.rubricLevel,
            feedback: `Feedback on ${String(task.learner_answer).split(" ")[0]}.`,
          }),
        };
      }
      const section = String(task.section);
      const level = String(task.level);
      const question = (k: number) => ({
        question: `[${level}] ${section} question ${n}.${k}?`,
        options: ["first", "second", "third", "fourth"],
        correct_index: 1,
      });
      const passage = section === "reading" || section === "listening";
      const free = section === "writing" || section === "speaking";
      return {
        data: request.schema.parse({
          section,
          subject: `${section} subject ${n}`,
          passage: passage ? `The ${section} text ${n}.` : null,
          questions: free ? [] : passage ? [question(1), question(2)] : [question(1)],
          task: free ? `The ${section} task ${n}.` : null,
        }),
      };
    },
  };

  sections(): string[] {
    return this.tasks.filter((task) => "section" in task).map((task) => String(task.section));
  }
}

describe.skipIf(!testServerUrl)("onboarding and the full placement test", () => {
  let database: Database;
  let cacheDir: string;
  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "coach-placement-tts-"));
    process.env.TTS_CACHE_DIR = cacheDir;
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(async () => {
    network.mockRestore();
    Reflect.deleteProperty(process.env, "TTS_CACHE_DIR");
    await rm(cacheDir, { recursive: true, force: true });
    await database.close();
  });

  /** The network: Telegram file downloads and the learner's OpenAI-compatible audio endpoints. */
  const network = spyOn(globalThis, "fetch");
  network.mockImplementation((async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/file/bot")) return new Response(AUDIO);
    if (url.endsWith("/audio/transcriptions")) return Response.json({ text: SPOKEN });
    if (url.endsWith("/audio/speech")) return new Response(AUDIO);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch);

  let nextUser = 930_001;
  let updateId = 6_000_000;
  async function setup(languageCode = "en") {
    const telegramId = nextUser++;
    const script = new ScriptedPlacement();
    const skills = new SkillRunner({
      registry: loadSkillRegistry(),
      provider: async () => script.provider,
      learner: learnerContextFromDb(database.db),
    });
    const h = createHarness(database.db, { adminIds: [telegramId], skills });
    // The fake Telegram does not know getFile; answer it in front of it.
    h.bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === "getFile") {
        const p = (payload ?? {}) as Record<string, unknown>;
        return {
          ok: true,
          result: { file_id: String(p.file_id), file_path: "voice/file.oga" },
        } as never;
      }
      return prev(method, payload, signal);
    });
    const events: SettingsChanged[] = [];
    h.settingsEvents.on("settings.changed", (event) => {
      events.push(event);
    });

    const chat = () => h.telegram.chat(telegramId);
    const bot = () => [...chat().values()].filter((message) => message.from === "bot");
    const card = () => {
      const message = bot().findLast((m) => m.text !== "[voice]");
      if (!message) throw new Error("no bot message in the chat");
      return message;
    };
    const tap = (callback: OnboardingCallback) =>
      h.press(telegramId, card().id, encodeOnboardingCallback(callback));
    const settings = async () => {
      const user = await findUserByTelegramId(database.db, telegramId);
      const found = user && (await getSettings(database.db, user.id));
      if (!user || !found) throw new Error("user has no settings");
      return { user, settings: found };
    };
    const hub = async () => {
      const { user } = await settings();
      const found = await getHub(database.db, user.id);
      if (!found) throw new Error("no hub");
      return found;
    };
    const hubOnly = async () => {
      const { user } = await settings();
      const found = await hub();
      expect([...chat().keys()]).toEqual([found.messageId]);
      expect(h.telegram.pinned.get(telegramId)).toBe(found.messageId);
      expect(await findActiveSession(database.db, user.id)).toBeUndefined();
      return found;
    };
    const hubLabels = async () =>
      chat()
        .get((await hub()).messageId)
        ?.labels.flat() ?? [];
    const pressHub = async (callback: Callback) =>
      h.press(telegramId, (await hub()).messageId, encodeCallback(callback));
    const start = () => h.say(telegramId, "/start", languageCode);
    /** The welcome steps the quickest way: English, one goal, no interests, no profession. */
    const welcome = async () => {
      await start();
      await tap({ type: "lang", lang: "en" });
      await tap({ type: "goal", goal: "everyday" });
      await tap({ type: "goals-done" });
      await tap({ type: "interests-done" });
      await tap({ type: "profession-skip" });
      await tap({ type: "provider", choice: "server" });
    };
    /** Taps option `index` of the question on screen: its buttons carry the item's number. */
    const answer = (index: number) => {
      const data = card().buttons[0]?.[index];
      if (!data) throw new Error("the card shows no answer buttons");
      return h.press(telegramId, card().id, data);
    };
    /** Answers the question on screen as a learner of `level`: right at or below it, else wrong. */
    const answerAs = (level: string) => {
      const pitched = /\[([ABC][12])\]/.exec(card().text)?.[1] ?? "";
      if (!pitched) throw new Error(`not a question: ${card().text}`);
      return answer(LEVELS.indexOf(pitched) <= LEVELS.indexOf(level) ? 1 : 0);
    };
    const answerQuestions = async (count: number, level: string) => {
      for (let n = 0; n < count; n++) await answerAs(level);
    };
    /** The learner sends a voice message. */
    const sayVoice = async (duration = 30) => {
      const id = h.telegram.userMessage(telegramId, "");
      await h.bot.handleUpdate({
        update_id: updateId++,
        message: {
          message_id: id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: telegramId, type: "private", first_name: `User${telegramId}` },
          from: { id: telegramId, is_bot: false, first_name: "U", language_code: "en" },
          voice: { file_id: "voice-1", file_unique_id: "u1", duration, mime_type: "audio/ogg" },
        },
      } as never);
      return id;
    };
    /** The learner's own OpenAI key: it voices the clips and transcribes the answers. */
    const withAudioKey = async () => {
      const { user } = await settings();
      await activateProviderConfig(
        database.db,
        user.id,
        { kind: "openai", apiKey: "sk-user-audio-key", baseUrl: "https://audio.example/v1" },
        TEST_MASTER_KEY,
      );
    };
    const toasts = () =>
      h.telegram.callsOf("answerCallbackQuery").map((call) => String(call.payload.text ?? ""));

    return {
      h,
      script,
      telegramId,
      events,
      chat,
      bot,
      card,
      tap,
      settings,
      hub,
      hubOnly,
      hubLabels,
      pressHub,
      start,
      welcome,
      answer,
      answerQuestions,
      sayVoice,
      withAudioKey,
      toasts,
    };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;
  const buttons = (message: { buttons: string[][] }) => message.buttons.flat();

  /** A learner with a level, as if they had taken the test before. */
  async function placed(s: Setup, level: "A2" | "B1" = "B1") {
    await s.welcome();
    const { user } = await s.settings();
    await seedLevels(database.db, user.id, level, "placement");
    await s.h.sessions.expire((await findActiveSession(database.db, user.id))?.id ?? -1);
    await s.h.say(s.telegramId, "/menu");
    return s.hubOnly();
  }

  test("a full run sets all six skill levels and ends with exactly the pinned hub", async () => {
    const s = await setup("uk");
    await s.start();
    expect(s.card().text).toContain("Ласкаво просимо");
    await s.tap({ type: "lang", lang: "ru" });
    await s.tap({ type: "goal", goal: "it" });
    await s.tap({ type: "goals-done" });
    await s.tap({ type: "interest", index: 1 });
    await s.tap({ type: "interests-done" });
    await s.h.say(s.telegramId, "Backend developer");
    await s.withAudioKey();

    // No "I know my level": the provider step leads straight to the test.
    await s.tap({ type: "provider", choice: "server" });
    expect(s.card().text).toContain("шесть коротких разделов");
    expect(buttons(s.card())).toEqual([encodeOnboardingCallback({ type: "take-test" })]);
    await s.tap({ type: "take-test" });

    // Grammar and vocabulary: seven adaptive questions each, one card edited in place.
    expect(s.card().text).toContain("Раздел 1/6 · Грамматика · 1/7");
    await s.answerQuestions(7, "B2");
    expect(s.card().text).toContain("Раздел 2/6 · Словарь · 1/7");
    expect(s.bot()).toHaveLength(1);
    await s.answerQuestions(7, "B2");

    // Reading: the text and its questions, two texts of two questions.
    expect(s.card().text).toContain("Раздел 3/6");
    expect(s.card().text).toContain("The reading text");
    await s.answerQuestions(4, "B2");

    // Listening needs voice: the learner turns it on, and each question comes with its clip.
    expect(s.card().text).toContain("Раздел 4/6");
    expect(buttons(s.card())).toContain(encodeOnboardingCallback({ type: "voice-on" }));
    await s.tap({ type: "voice-on" });
    expect(s.card().text).not.toContain("The listening text");
    expect(s.bot().map((m) => m.text)).toContain("[voice]");
    expect(s.bot()).toHaveLength(2);
    await s.answerQuestions(4, "B2");

    // Writing: a typed answer; too short is a note, a voice answer is refused.
    expect(s.card().text).toContain("Раздел 5/6");
    expect(s.card().text).toContain("The writing task");
    await s.h.say(s.telegramId, "I like Japan.");
    await s.h.sessions.flushNotes();
    expect(s.card().text).toContain("Раздел 5/6");
    await s.h.say(s.telegramId, WRITTEN);

    // Speaking: a voice answer, graded from its transcript; a typed one is refused.
    expect(s.card().text).toContain("Раздел 6/6");
    await s.h.say(s.telegramId, "I would rather type my answer here instead of speaking it");
    await s.h.sessions.flushNotes();
    expect(s.card().text).toContain("Раздел 6/6");
    await s.sayVoice();
    // The transcript shows for a few seconds as a note.
    await s.h.sessions.flushNotes();

    const rubrics = s.script.tasks.filter((task) => "learner_answer" in task);
    expect(rubrics.map((task) => task.learner_answer)).toEqual([WRITTEN, SPOKEN]);
    expect(s.script.sections()).toEqual([
      ...Array(7).fill("grammar"),
      ...Array(7).fill("vocabulary"),
      "reading",
      "reading",
      "listening",
      "listening",
      "writing",
      "speaking",
    ]);

    // The result, in the explanation language, with every skill and the rubric feedback.
    const { user, settings } = await s.settings();
    expect(s.card().text).toContain("🎯 Ваш уровень: B2");
    for (const skill of ["Грамматика", "Словарь", "Чтение", "Аудирование", "Письмо", "Говорение"]) {
      expect(s.card().text).toContain(`• ${skill}:`);
    }
    expect(s.card().text).toContain(`Feedback on ${WRITTEN.split(" ")[0]}.`);
    expect(settings.cefrLevel).toBe("B2");
    const levels = await getLevels(database.db, user.id);
    // A learner who passes every B2 item and fails every C1 one sits at the B2/C1 boundary.
    for (const skill of SKILLS) {
      expect(levels?.skills[skill]?.rating).toBeGreaterThanOrEqual(3.5);
      expect(levels?.skills[skill]?.rating).toBeLessThan(4.25);
      expect(levels?.skills[skill]?.evidence).toBeGreaterThan(0);
    }
    expect(levels?.skills.grammar?.evidence).toBe(7);
    expect(levels?.skills.reading?.evidence).toBe(4);
    expect(levels?.skills.writing).toMatchObject({ evidence: 1, label: "B2.5" });

    await s.tap({ type: "continue" });
    await s.tap({ type: "words", count: 10 });
    await s.tap({ type: "morning", time: "07:30" });
    await s.tap({ type: "evening", time: "21:00" });

    await s.hubOnly();
    expect(await s.hubLabels()).toContain("📚 Учить слова");
    expect([...s.chat().values()][0]?.text).toContain("Тест уровня: B2.");
    expect(s.events.flatMap((event) => event.changed)).toEqual([
      "uiLang",
      "explainLang",
      "goals",
      "interests",
      "profession",
      "voiceEnabled",
      "cefrLevel",
      "wordsPerDay",
      "morningTime",
      "eveningTime",
    ]);
  });

  test("the hub stays locked until the test is done; a stale learning button is refused", async () => {
    const s = await setup();
    await s.start();
    await s.tap({ type: "lang", lang: "en" });
    const { user } = await s.settings();
    const session = await findActiveSession(database.db, user.id);
    await s.h.sessions.expire(session?.id ?? -1);

    await s.hubOnly();
    expect(await s.hubLabels()).toEqual(["🧭 Placement test", "⚙️ Settings"]);
    expect(s.chat().get((await s.hub()).messageId)?.text).toContain("Lessons open after");

    // A learning button of an older, unlocked hub starts nothing.
    await s.pressHub({ type: "activity", activity: "learn" });
    expect(s.toasts()).toContain("Take the placement test first.");
    expect(await findActiveSession(database.db, user.id)).toBeUndefined();

    // Settings has no level picker to skip the test with; a stale level button is ignored.
    await s.pressHub({ type: "settings", page: "root" });
    expect(
      s
        .chat()
        .get((await s.hub()).messageId)
        ?.buttons.flat(),
    ).not.toContain(encodeCallback({ type: "settings", page: "level" }));
    await s.pressHub({ type: "set", change: { field: "cefrLevel", value: "C1" } });
    expect((await s.settings()).settings.cefrLevel).toBeNull();
    await s.pressHub({ type: "screen", screen: "main" });

    // The hub's test button starts onboarding again: no goals were saved, so from the welcome.
    await s.pressHub({ type: "placement" });
    expect(s.card().text).toContain("Welcome to EnglishCoach");
  });

  test("a session that expires mid-test stores nothing; the test restarts from the beginning", async () => {
    const s = await setup();
    await s.welcome();
    await s.tap({ type: "take-test" });
    await s.answerQuestions(7, "C1");
    expect(s.card().text).toContain("Section 2/6 · Vocabulary · 1/7");
    await s.answerQuestions(3, "C1");

    const { user } = await s.settings();
    await s.h.sessions.expire((await findActiveSession(database.db, user.id))?.id ?? -1);
    await s.hubOnly();
    expect((await s.settings()).settings.cefrLevel).toBeNull();
    expect(await getLevels(database.db, user.id)).toBeUndefined();
    expect(await s.hubLabels()).toContain("🧭 Placement test");

    // The welcome steps are saved; the test itself starts over at its first question.
    await s.start();
    expect(s.card().text).toContain("six short sections");
    await s.tap({ type: "take-test" });
    expect(s.card().text).toContain("Section 1/6 · Grammar · 1/7");
    expect(s.card().text).toContain("[B1]");
  });

  test("a provider failure offers a retry that continues the same test", async () => {
    const s = await setup();
    await s.welcome();
    await s.tap({ type: "take-test" });
    await s.answerQuestions(2, "B1");

    s.script.failNext = 1;
    await s.answerQuestions(1, "B1");
    expect(s.card().text).toContain("could not continue");
    // Onboarding offers no way around the test.
    expect(buttons(s.card())).toEqual([encodeOnboardingCallback({ type: "retry" })]);

    await s.tap({ type: "retry" });
    expect(s.card().text).toContain("Section 1/6 · Grammar · 4/7");
    expect(s.bot()).toHaveLength(1);
  });

  test("a learner without voice skips listening and speaking; those skills show as unmeasured", async () => {
    const s = await setup();
    await s.welcome();
    await s.tap({ type: "take-test" });
    await s.answerQuestions(18, "A2");

    expect(s.card().text).toContain("Section 4/6 · Listening");
    // Only the voice sections can be skipped.
    await s.tap({ type: "skip-section" });
    expect(s.card().text).toContain("Section 5/6 · Writing");
    await s.tap({ type: "skip-section" });
    expect(s.card().text).toContain("Section 5/6 · Writing");
    s.script.rubricLevel = "A2";
    await s.h.say(s.telegramId, WRITTEN);
    expect(s.card().text).toContain("Section 6/6 · Speaking");
    await s.tap({ type: "skip-section" });

    expect(s.card().text).toContain("~ marks a skill the test did not measure");
    const { user } = await s.settings();
    const levels = await getLevels(database.db, user.id);
    expect(levels?.skills.listening).toMatchObject({
      evidence: 0,
      uncertainty: SEEDED_UNCERTAINTY.chosen,
    });
    expect(levels?.skills.speaking?.evidence).toBe(0);
    expect(levels?.skills.writing?.evidence).toBe(1);
    expect(s.script.sections()).not.toContain("listening");
  });

  test("voice on but nothing can voice a clip: listening is skipped on its own", async () => {
    const s = await setup();
    await s.welcome();
    const { user } = await s.settings();
    await updateSettings(database.db, user.id, { voiceEnabled: true });
    await s.tap({ type: "take-test" });
    await s.answerQuestions(18, "B1");
    expect(s.card().text).toContain("Section 5/6 · Writing");
    expect(s.script.sections()).not.toContain("listening");
  });

  test("/start in the middle of onboarding re-sends the current step; old buttons are dead", async () => {
    const s = await setup();
    await s.start();
    await s.tap({ type: "lang", lang: "ru" });
    const oldCard = s.card().id;

    await s.start();
    expect(s.bot()).toHaveLength(1);
    expect(s.card().id).not.toBe(oldCard);
    expect(buttons(s.card())).toContain(encodeOnboardingCallback({ type: "goals-done" }));

    await s.h.press(s.telegramId, oldCard, encodeOnboardingCallback({ type: "lang", lang: "uk" }));
    await s.h.press(s.telegramId, oldCard, encodeOnboardingCallback({ type: "goal", goal: "it" }));
    expect((await s.settings()).settings.uiLang).toBe("ru");
    expect(s.card().labels.flat()).not.toContain("✓ 💻 IT");
  });

  test("an answer button of an earlier question is stale", async () => {
    const s = await setup();
    await s.welcome();
    await s.tap({ type: "take-test" });
    const first = s.card().buttons[0]?.[1] ?? "";
    await s.answerQuestions(1, "B1");
    await s.h.press(s.telegramId, s.card().id, first);
    expect(s.toasts().at(-1)).toContain("already");
    expect(s.card().text).toContain("Grammar · 2/7");
  });

  test("goals are toggled one tap at a time; Next needs one", async () => {
    const s = await setup();
    await s.start();
    await s.tap({ type: "lang", lang: "en" });
    await s.tap({ type: "goals-done" });
    expect(s.card().text).toContain("Why are you learning English?");
    expect((await s.settings()).settings.goals).toEqual([]);

    await s.tap({ type: "goal", goal: "exam" });
    await s.tap({ type: "goals-done" });
    // A stale goal button on the interests step changes nothing.
    await s.tap({ type: "goal", goal: "travel" });
    expect(s.card().text).toContain("What are you into?");
    expect((await s.settings()).settings.goals).toEqual(["exam"]);
  });

  test("a button that does not fit the current step changes nothing", async () => {
    const s = await setup();
    await s.start();
    const before = JSON.stringify(s.card());
    await s.tap({ type: "take-test" });
    await s.tap({ type: "skip-section" });
    await s.tap({ type: "words", count: 20 });
    expect(JSON.stringify(s.card())).toBe(before);
    expect((await s.settings()).settings.cefrLevel).toBeNull();
  });

  test("Settings → Retake placement test re-runs only the test and returns to the hub", async () => {
    const s = await setup();
    await placed(s, "A2");
    await s.pressHub({ type: "settings", page: "root" });
    await s.pressHub({ type: "placement" });

    // The hub stays until the session ends; the test card is the new message.
    expect(s.bot()).toHaveLength(2);
    expect(s.card().text).toContain("measures every skill again");
    await s.tap({ type: "take-test" });
    await s.answerQuestions(18, "C1");
    await s.tap({ type: "skip-section" });
    s.script.rubricLevel = "C1";
    await s.h.say(s.telegramId, WRITTEN);
    await s.tap({ type: "skip-section" });
    expect(s.card().text).toContain("Your level: C1");
    await s.tap({ type: "continue" });

    await s.hubOnly();
    expect((await s.settings()).settings.cefrLevel).toBe("C1");
    expect([...s.chat().values()][0]?.text).toContain("Placement test: C1.");
  });

  test("cancelling a retake leaves the level alone", async () => {
    const s = await setup();
    await placed(s, "B1");
    await s.pressHub({ type: "placement" });
    await s.tap({ type: "cancel" });

    await s.hubOnly();
    expect((await s.settings()).settings.cefrLevel).toBe("B1");
    expect(s.script.tasks).toHaveLength(0);
  });
});
