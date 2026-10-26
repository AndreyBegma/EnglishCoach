import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { upsertMistake } from "../../src/db/repositories/mistakes";
import { findUserByTelegramId } from "../../src/db/repositories/users";
import { encodeGrammarCallback } from "../../src/grammar/callbacks";
import { encodeProgressCallback, parseProgressCallback } from "../../src/progress/callbacks";
import { createHarness, type Harness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { choiceItem, scriptedSkills } from "../grammar/script";

const OPTIONS = ["has lived", "lives", "is living", "lived"];

describe("progress callbacks", () => {
  test("round-trip and stay within Telegram's limit", () => {
    for (const type of ["weak", "practice"] as const) {
      const data = encodeProgressCallback({ type });
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(parseProgressCallback(data)).toEqual({ type });
    }
    expect(parseProgressCallback("1:g:r")).toBeUndefined();
    expect(parseProgressCallback("2:p:w")).toBeUndefined();
    expect(parseProgressCallback(undefined)).toBeUndefined();
  });
});

describe.skipIf(!testServerUrl)("Progress screens over a mocked Telegram API", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  let nextUser = 920_001;
  async function setup(queue: unknown[]) {
    const telegramId = nextUser++;
    const script = scriptedSkills(database.db, queue);
    const h = createHarness(database.db, { adminIds: [telegramId], skills: script.skills });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    return { h, telegramId, user, ...script };
  }

  const hubOf = async (h: Harness, telegramId: number, userId: number) => {
    const hub = await getHub(database.db, userId);
    const message = h.telegram.chat(telegramId).get(hub?.messageId ?? 0);
    if (!hub || !message) throw new Error("no hub");
    return message;
  };

  const mistake = (pattern: string, times: number, userId: number) =>
    Array.from({ length: times }, () =>
      upsertMistake(database.db, userId, {
        category: "grammar",
        pattern,
        exampleWrong: "I bought car.",
        exampleRight: "I bought a car.",
        explanation: "Use an article.",
      }),
    );

  test("Hub → Progress → Weak spots edits the hub message and goes back", async () => {
    const { h, telegramId, user } = await setup([]);
    for (const run of [
      ...mistake("missing article", 3, user.id),
      ...mistake("wrong preposition", 1, user.id),
    ]) {
      await run;
    }

    const hub = await hubOf(h, telegramId, user.id);
    await h.press(telegramId, hub.id, encodeCallback({ type: "screen", screen: "progress" }));
    const progress = await hubOf(h, telegramId, user.id);
    expect(progress.id).toBe(hub.id); // edited in place, not re-sent
    expect(progress.text).toContain("📈 Progress");
    expect(progress.text).toContain("missing article ×3");
    expect(progress.text).toContain("wrong preposition ×1");
    expect(progress.buttons.flat()).toContain(encodeProgressCallback({ type: "weak" }));

    await h.press(telegramId, hub.id, encodeProgressCallback({ type: "weak" }));
    const weak = await hubOf(h, telegramId, user.id);
    expect(weak.id).toBe(hub.id);
    expect(weak.text).toContain("1. missing article ×3");
    expect(weak.text).toContain("❌ I bought car.");
    expect(weak.text).toContain("✅ I bought a car.");
    expect(weak.buttons.flat()).toContain(encodeProgressCallback({ type: "practice" }));

    await h.press(telegramId, hub.id, encodeCallback({ type: "screen", screen: "progress" }));
    expect((await hubOf(h, telegramId, user.id)).text).toContain("📈 Progress");
  });

  test("renders in the learner's UI language", async () => {
    const { h, telegramId, user } = await setup([]);
    await h.say(telegramId, "/menu");
    const { userSettings } = await import("../../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await database.db
      .update(userSettings)
      .set({ uiLang: "uk" })
      .where(eq(userSettings.userId, user.id));
    const hub = await hubOf(h, telegramId, user.id);
    await h.press(telegramId, hub.id, encodeCallback({ type: "screen", screen: "progress" }));
    expect((await hubOf(h, telegramId, user.id)).text).toContain("Прогрес");
  });

  test("Practice these starts a grammar session seeded with the weak patterns", async () => {
    const { h, telegramId, user, requests } = await setup([
      choiceItem("x", "She ___ here since 2019.", OPTIONS, 0),
      choiceItem("x", "She ___ here since 2019.", OPTIONS, 0),
    ]);
    for (const run of [
      ...mistake("missing article", 3, user.id),
      ...mistake("wrong preposition", 1, user.id),
    ]) {
      await run;
    }
    const hub = await hubOf(h, telegramId, user.id);
    await h.press(telegramId, hub.id, encodeProgressCallback({ type: "weak" }));
    await h.press(telegramId, hub.id, encodeProgressCallback({ type: "practice" }));

    const bot = [...h.telegram.chat(telegramId).values()].filter((m) => m.from === "bot");
    expect(bot.some((m) => m.text.includes("Practising your weak spots (2 patterns)"))).toBe(true);
    // No topic picker: the first question is asked straight away.
    expect(bot.at(-1)?.text).toContain("Question 1 of 10");
    expect(requests[0]?.messages.at(-1)?.content).toContain('"topic": "missing article"');

    // The next question takes the next pattern.
    await h.press(
      telegramId,
      bot.at(-1)?.id ?? 0,
      encodeGrammarCallback({ type: "answer", question: 1, option: 0 }),
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain('"topic": "wrong preposition"');
  });

  test("Practice these with no mistakes only answers with a notice", async () => {
    const { h, telegramId, user } = await setup([]);
    const hub = await hubOf(h, telegramId, user.id);
    await h.press(telegramId, hub.id, encodeProgressCallback({ type: "practice" }));
    expect(h.telegram.chat(telegramId).get(hub.id)?.text).toBe(hub.text);
  });

  test("a stale Progress button is answered as outdated", async () => {
    const { h, telegramId, user } = await setup([]);
    const old = await hubOf(h, telegramId, user.id);
    await h.say(telegramId, "/menu"); // a fresh hub; the old message is gone
    await h.press(telegramId, old.id, encodeProgressCallback({ type: "weak" }));
    const fresh = await hubOf(h, telegramId, user.id);
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.text).toContain("what shall we do");
  });
});
