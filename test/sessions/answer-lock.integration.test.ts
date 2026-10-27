import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Update } from "grammy/types";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findUserByTelegramId } from "../../src/db/repositories/users";
import { encodeGrammarCallback } from "../../src/grammar/callbacks";
import type { CompletionRequest, LlmProvider } from "../../src/llm/types";
import { encodeOnboardingCallback, type OnboardingCallback } from "../../src/onboarding/callbacks";
import { MemorySessionLocks } from "../../src/sessions/locks";
import { sessionLockKey } from "../../src/sessions/session-manager";
import { learnerContextFromDb, loadSkillRegistry, SkillRunner } from "../../src/skills";
import { createHarness, type HarnessOptions } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { choiceItem, typedItem } from "../grammar/script";

/**
 * A skill runner over a scripted provider that can be held: while `hold()` is in force, every
 * model call waits, so a test can act while an answer is still being handled.
 */
function gatedSkills(db: Database["db"], queue: (unknown | Error)[]) {
  const requests: CompletionRequest<unknown>[] = [];
  let gate: Promise<void> | undefined;
  const provider: LlmProvider = {
    kind: "server",
    async complete<T>(req: CompletionRequest<T>) {
      requests.push(req as CompletionRequest<unknown>);
      if (gate) await gate;
      const next = queue.shift();
      if (next === undefined) throw new Error("scripted provider ran out of answers");
      if (next instanceof Error) throw next;
      return { data: req.schema.parse(next) };
    },
  };
  const skills = new SkillRunner({
    registry: loadSkillRegistry(),
    provider: async () => provider,
    learner: learnerContextFromDb(db),
  });
  /** Holds every model call until the returned function is called. */
  const hold = () => {
    let release = () => {};
    gate = new Promise<void>((resolve) => {
      release = () => {
        gate = undefined;
        resolve();
      };
    });
    return release;
  };
  return { skills, queue, requests, hold };
}

const placementItem = (n: number) => ({
  status: "continue",
  estimate: { level: "B1", confidence: 0.4 },
  item: {
    level: "B1",
    skill: "grammar",
    topic: `topic ${n}`,
    question: `Question text ${n}?`,
    options: ["first", "second", "third", "fourth"],
    correct_index: 1,
  },
  summary: null,
});

/** Resolves once `condition` holds; fails the test after about a second. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await Bun.sleep(5);
  }
  throw new Error("condition never became true");
}

describe.skipIf(!testServerUrl)("one answer at a time, over a mocked Telegram API", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  let nextUser = 935_001;
  async function setup(queue: unknown[], options: HarnessOptions = {}) {
    const telegramId = nextUser++;
    const script = gatedSkills(database.db, queue);
    const h = createHarness(database.db, {
      adminIds: [telegramId],
      skills: script.skills,
      ...options,
    });
    const bot = () => [...h.telegram.chat(telegramId).values()].filter((m) => m.from === "bot");
    const card = () => {
      const last = bot().at(-1);
      if (!last) throw new Error("no bot message in the chat");
      return last;
    };
    const toasts = () =>
      h.telegram.callsOf("answerCallbackQuery").map((call) => call.payload.text as string);
    return { h, telegramId, card, toasts, ...script };
  }

  /** Onboarding up to the first placement item. */
  async function placement(queue: unknown[]) {
    const s = await setup(queue);
    const tap = (callback: OnboardingCallback) =>
      s.h.press(s.telegramId, s.card().id, encodeOnboardingCallback(callback));
    await s.h.say(s.telegramId, "/start");
    await tap({ type: "lang", lang: "en" });
    await tap({ type: "provider", choice: "server" });
    await tap({ type: "take-test" });
    return { ...s, tap };
  }

  test("three taps on one placement item record one answer; the next item is untouched", async () => {
    const s = await placement([placementItem(0), placementItem(1), placementItem(2)]);
    const first = s.card();
    expect(first.text).toContain("Question text 0?");
    const b = first.buttons[0]?.[1] ?? "";

    // Polling hands the bot one update at a time: the extra taps arrive after the next item.
    await s.h.press(s.telegramId, first.id, b);
    await s.h.press(s.telegramId, first.id, b);
    await s.h.press(s.telegramId, first.id, b);

    expect(s.requests).toHaveLength(2); // the first item, then the second: one answer graded
    expect(s.card().text).toContain("Question 2 of up to 15");
    expect(s.card().text).toContain("Question text 1?");
    expect(s.toasts().slice(-3)).toEqual([
      "Answer “B) second” accepted",
      "This question is already answered",
      "This question is already answered",
    ]);

    // The second item still takes its own answer, and the model saw one answer before it.
    await s.h.press(s.telegramId, s.card().id, s.card().buttons[0]?.[0] ?? "");
    expect(s.requests).toHaveLength(3);
    const sent = s.requests.at(-1)?.messages.at(-1)?.content ?? "";
    expect(sent.match(/"correct"/g)).toHaveLength(2);
  });

  test("the choice is marked and the keyboard removed before the model answers; taps meanwhile wait", async () => {
    const s = await placement([placementItem(0), placementItem(1)]);
    const first = s.card();
    const b = first.buttons[0]?.[1] ?? "";

    const release = s.hold();
    const accepted = s.h.press(s.telegramId, first.id, b);
    await until(() => s.requests.length === 2);

    // The model call is still pending: the card already reads as answered.
    expect(s.card().id).toBe(first.id);
    expect(s.card().buttons.flat()).toEqual([]);
    expect(s.card().text).toContain("Question text 0?");
    expect(s.card().text).toContain("✅ B) second");
    expect(s.card().text).toContain("⏳ Preparing the next question…");
    expect(s.h.telegram.callsOf("sendChatAction").at(-1)?.payload).toMatchObject({
      action: "typing",
    });

    // Webhooks run updates side by side: taps that reach the bot now are dropped, not queued.
    await s.h.press(s.telegramId, first.id, b);
    await s.h.press(s.telegramId, first.id, s.card().buttons[0]?.[2] ?? b);
    expect(s.toasts().slice(-2)).toEqual([
      "Wait, preparing the next question",
      "Wait, preparing the next question",
    ]);

    release();
    await accepted;
    expect(s.requests).toHaveLength(2);
    expect(s.card().text).toContain("Question text 1?");
    expect(s.card().buttons[0]).toHaveLength(4);
  });

  test("a failed model call releases the lock: Try again goes through", async () => {
    const s = await placement([placementItem(0), new Error("provider is down"), placementItem(1)]);
    await s.h.press(s.telegramId, s.card().id, s.card().buttons[0]?.[1] ?? "");
    expect(s.card().text).toContain("The test could not continue");

    await s.tap({ type: "retry" });
    expect(s.toasts().at(-1)).toBe("Answer “Try again” accepted");
    expect(s.card().text).toContain("Question text 1?");
  });

  test("the lock is released when the work throws", async () => {
    const s = await setup([]);
    const key = sessionLockKey(424_242);
    const failing = s.h.sessions.withLock(key, async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    let ran = false;
    expect(
      await s.h.sessions.withLock(key, async () => {
        ran = true;
      }),
    ).toBe(true);
    expect(ran).toBe(true);
  });

  /** A grammar session at the topic picker. */
  async function grammar(queue: unknown[], options: HarnessOptions = {}) {
    const s = await setup(queue, options);
    await s.h.say(s.telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, s.telegramId);
    const hub = user && (await getHub(database.db, user.id));
    await s.h.press(
      s.telegramId,
      hub?.messageId ?? 0,
      encodeCallback({ type: "activity", activity: "grammar" }),
    );
    expect(s.toasts().at(-1)).toBe("⏳ Getting it ready…");
    return s;
  }

  const OPTIONS = ["has lived", "lives", "is living", "lived"];

  test("a message sent while the next question is prepared gets a passing wait note", async () => {
    const s = await grammar([choiceItem("tenses", "She ___ here.", OPTIONS, 0)]);
    const picker = s.card();

    const release = s.hold();
    const picked = s.h.press(
      s.telegramId,
      picker.id,
      encodeGrammarCallback({ type: "topic", id: null }),
    );
    await until(() => s.requests.length === 1);
    expect(s.card().text).toContain("✅ 🎲 Mixed");

    const typed = await s.h.say(s.telegramId, "has lived");
    expect(s.h.telegram.chat(s.telegramId).has(typed)).toBe(false);
    const note = s.card();
    expect(note.text).toBe("Wait, preparing the next question");
    await s.h.sessions.flushNotes();
    expect(s.h.telegram.chat(s.telegramId).has(note.id)).toBe(false);

    release();
    await picked;
    expect(s.card().text).toContain("Question 1 of 10");
    expect(s.requests).toHaveLength(1); // the dropped message was never graded
  });

  test("a message that queued up behind the last answer (polling) is dropped too", async () => {
    // Polling reads it only after the lock is free; its Telegram date says when it was sent.
    const locks = new MemorySessionLocks();
    const heldTo = Date.now() - 1;
    locks.lastHeld = async () => ({ from: heldTo - 10_000, to: heldTo });
    const s = await grammar(
      [typedItem("gap_fill", "tenses", "She ___ (live) here.", ["has lived"])],
      { locks },
    );
    await s.h.press(s.telegramId, s.card().id, encodeGrammarCallback({ type: "topic", id: null }));
    const question = s.card();

    const id = s.h.telegram.userMessage(s.telegramId, "has lived");
    await s.h.bot.handleUpdate({
      update_id: 900_000 + id,
      message: {
        message_id: id,
        date: Math.floor((heldTo - 5_000) / 1000),
        chat: { id: s.telegramId, type: "private", first_name: "Learner" },
        from: { id: s.telegramId, is_bot: false, first_name: "Learner" },
        text: "has lived",
      },
    } as Update);

    expect(s.h.telegram.chat(s.telegramId).has(id)).toBe(false);
    expect(s.card().text).toBe("Wait, preparing the next question");
    expect(s.requests).toHaveLength(1);
    expect(s.h.telegram.chat(s.telegramId).get(question.id)?.text).toBe(question.text);
  });
});
