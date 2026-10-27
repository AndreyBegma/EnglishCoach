import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Callback, encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findActiveSession } from "../../src/db/repositories/sessions";
import { findUserByTelegramId, getSettings } from "../../src/db/repositories/users";
import type { SettingsChanged } from "../../src/events/settings-events";
import type { LlmProvider } from "../../src/llm";
import { encodeOnboardingCallback, type OnboardingCallback } from "../../src/onboarding/callbacks";
import { learnerContextFromDb, loadSkillRegistry, SkillRunner } from "../../src/skills";
import { createHarness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const SUMMARY = "You are solid at B2. Grammar is strong. Idioms need work.";

/** Plays the model: items until `finalAfter` answers are in, then a verdict. */
class ScriptedPlacement {
  /** The answer count at which the skill reports `final`; never, when undefined. */
  finalAfter: number | undefined;
  /** The next calls fail like a broken provider. */
  failNext = 0;
  /** How many calls got an answer (a failed call does not count). */
  calls = 0;

  readonly provider: LlmProvider = {
    kind: "anthropic",
    complete: async (request) => {
      if (this.failNext > 0) {
        this.failNext--;
        throw new Error("provider is down");
      }
      const answers = this.calls++;
      if (this.finalAfter !== undefined && answers >= this.finalAfter) {
        return {
          data: request.schema.parse({
            status: "final",
            estimate: { level: "B2", confidence: 0.9 },
            item: null,
            summary: SUMMARY,
          }),
        };
      }
      return {
        data: request.schema.parse({
          status: "continue",
          estimate: { level: "B1", confidence: 0.4 },
          item: {
            level: "B1",
            skill: "grammar",
            topic: `topic ${answers}`,
            question: `Question text ${answers}?`,
            options: ["first", "second", "third", "fourth"],
            correct_index: 1,
          },
          summary: null,
        }),
      };
    },
  };
}

describe.skipIf(!testServerUrl)("onboarding and placement with a mocked Telegram API", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  let nextUser = 920_001;
  async function setup(languageCode = "en") {
    const telegramId = nextUser++;
    const script = new ScriptedPlacement();
    const skills = new SkillRunner({
      registry: loadSkillRegistry(),
      provider: async () => script.provider,
      learner: learnerContextFromDb(database.db),
    });
    const h = createHarness(database.db, { adminIds: [telegramId], skills });
    const events: SettingsChanged[] = [];
    h.settingsEvents.on("settings.changed", (event) => {
      events.push(event);
    });

    const chat = () => h.telegram.chat(telegramId);
    const bot = () => [...chat().values()].filter((message) => message.from === "bot");
    const card = () => {
      const message = bot().at(-1);
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
    const hubOnly = async () => {
      const { user } = await settings();
      const hub = await getHub(database.db, user.id);
      expect([...chat().keys()]).toEqual([hub?.messageId ?? -1]);
      expect(h.telegram.pinned.get(telegramId)).toBe(hub?.messageId ?? -1);
      expect(await findActiveSession(database.db, user.id)).toBeUndefined();
      return hub;
    };
    const start = () => h.say(telegramId, "/start", languageCode);
    /** Taps option `index` of the item on screen: its buttons carry the item's number. */
    const answer = (index = 1) => {
      const data = card().buttons[0]?.[index];
      if (!data) throw new Error("the card shows no answer buttons");
      return h.press(telegramId, card().id, data);
    };

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
      hubOnly,
      start,
      answer,
    };
  }

  const buttons = (message: { buttons: string[][] }) => message.buttons.flat();

  test("a new learner onboards through the test and is left with only the pinned hub", async () => {
    const s = await setup("uk");
    s.script.finalAfter = 8;

    await s.start();
    expect(s.bot()).toHaveLength(1);
    expect(s.card().text).toContain("Ласкаво просимо");
    expect(buttons(s.card())).toContain(encodeOnboardingCallback({ type: "lang", lang: "ru" }));

    await s.tap({ type: "lang", lang: "ru" });
    await s.tap({ type: "provider", choice: "server" });
    await s.tap({ type: "take-test" });

    // Eight questions, one card edited in place.
    for (let n = 1; n <= 8; n++) {
      expect(s.card().text).toContain(`Question text ${n - 1}?`);
      expect(s.bot()).toHaveLength(1);
      await s.answer();
    }
    expect(s.script.calls).toBe(9);
    expect(s.card().text).toContain("B2");
    expect(s.card().text).toContain(SUMMARY);
    expect((await s.settings()).settings.cefrLevel).toBe("B2");

    await s.tap({ type: "continue" });
    await s.tap({ type: "words", count: 10 });
    await s.tap({ type: "morning", time: "07:30" });
    expect(s.bot()).toHaveLength(1);
    await s.tap({ type: "evening", time: "21:00" });

    const hub = await s.hubOnly();
    const hubLabels = s
      .chat()
      .get(hub?.messageId ?? -1)
      ?.labels.flat();
    expect(hubLabels).toContain("⚙️ Настройки");

    const { settings } = await s.settings();
    expect(settings).toMatchObject({
      uiLang: "ru",
      explainLang: "ru",
      cefrLevel: "B2",
      wordsPerDay: 10,
      morningTime: "07:30:00",
      eveningTime: "21:00:00",
    });
    expect(s.events.flatMap((event) => event.changed)).toEqual([
      "uiLang",
      "explainLang",
      "cefrLevel",
      "wordsPerDay",
      "morningTime",
      "eveningTime",
    ]);
    // The one-line justification is folded into the hub.
    expect([...s.chat().values()][0]?.text).toContain("You are solid at B2.");
    expect([...s.chat().values()][0]?.text).not.toContain("Grammar is strong");
  });

  test("the test stops at 15 items even when the skill never reports confidence", async () => {
    const s = await setup();
    await s.start();
    await s.tap({ type: "lang", lang: "en" });
    await s.tap({ type: "provider", choice: "server" });
    await s.tap({ type: "take-test" });

    for (let n = 1; n <= 15; n++) {
      expect(s.card().text).toContain(`Question ${n} of up to 15`);
      await s.answer(n % 2);
    }
    expect(s.script.calls).toBe(16);
    expect(s.card().text).toContain("Your level: B1");
    expect(s.card().text).toContain("Based on 8 correct answers out of 15.");
    expect((await s.settings()).settings.cefrLevel).toBe("B1");
  });

  test("a learner who knows their level skips the test", async () => {
    const s = await setup();
    await s.start();
    await s.tap({ type: "lang", lang: "en" });
    await s.tap({ type: "provider", choice: "server" });
    await s.tap({ type: "know-level" });
    await s.tap({ type: "level", level: "C1" });
    await s.tap({ type: "words", count: 3 });
    await s.tap({ type: "morning", time: "06:30" });
    await s.tap({ type: "evening", time: "18:00" });

    await s.hubOnly();
    expect(s.script.calls).toBe(0);
    expect((await s.settings()).settings).toMatchObject({ cefrLevel: "C1", wordsPerDay: 3 });
  });

  test("choosing their own provider ends onboarding on Settings → AI provider", async () => {
    const s = await setup();
    await s.start();
    await s.tap({ type: "lang", lang: "en" });
    await s.tap({ type: "provider", choice: "own" });
    await s.tap({ type: "know-level" });
    await s.tap({ type: "level", level: "A2" });
    await s.tap({ type: "words", count: 5 });
    await s.tap({ type: "morning", time: "08:30" });
    await s.tap({ type: "evening", time: "20:00" });

    await s.hubOnly();
    expect(s.bot()[0]?.text).toContain("AI provider");
  });

  test("a provider failure offers a retry that continues the same test", async () => {
    const s = await setup();
    await s.start();
    await s.tap({ type: "lang", lang: "en" });
    await s.tap({ type: "provider", choice: "server" });

    s.script.failNext = 1;
    await s.tap({ type: "take-test" });
    expect(s.card().text).toContain("could not continue");
    expect(buttons(s.card())).toEqual([
      encodeOnboardingCallback({ type: "retry" }),
      encodeOnboardingCallback({ type: "know-level" }),
    ]);
    expect((await s.settings()).settings.cefrLevel).toBeNull();

    await s.tap({ type: "retry" });
    expect(s.card().text).toContain("Question 1 of up to 15");
    expect(s.bot()).toHaveLength(1);
  });

  test("/start in the middle of onboarding re-sends the current step; old buttons are dead", async () => {
    const s = await setup();
    await s.start();
    await s.tap({ type: "lang", lang: "ru" });
    const oldCard = s.card().id;

    await s.start();
    expect(s.bot()).toHaveLength(1);
    expect(s.card().id).not.toBe(oldCard);
    expect(buttons(s.card())).toContain(
      encodeOnboardingCallback({ type: "provider", choice: "server" }),
    );

    await s.h.press(s.telegramId, oldCard, encodeOnboardingCallback({ type: "lang", lang: "uk" }));
    expect((await s.settings()).settings.uiLang).toBe("ru");
    expect(buttons(s.card())).toContain(
      encodeOnboardingCallback({ type: "provider", choice: "server" }),
    );
  });

  test("a button that does not fit the current step changes nothing", async () => {
    const s = await setup();
    await s.start();
    const before = JSON.stringify(s.card());
    await s.tap({ type: "level", level: "C2" });
    await s.tap({ type: "words", count: 20 });
    expect(JSON.stringify(s.card())).toBe(before);
    expect((await s.settings()).settings.cefrLevel).toBeNull();
  });

  test("Settings → Retake placement test re-runs only the test and returns to the hub", async () => {
    const s = await setup();
    await s.start();
    await s.tap({ type: "lang", lang: "en" });
    await s.tap({ type: "provider", choice: "server" });
    await s.tap({ type: "know-level" });
    await s.tap({ type: "level", level: "A2" });
    await s.tap({ type: "words", count: 15 });
    await s.tap({ type: "morning", time: "09:00" });
    await s.tap({ type: "evening", time: "19:00" });
    const hub = await s.hubOnly();
    if (!hub) throw new Error("no hub");

    const press = (callback: Callback) =>
      s.h.press(s.telegramId, hub.messageId, encodeCallback(callback));
    await press({ type: "settings", page: "root" });
    await press({ type: "settings", page: "level" });
    await press({ type: "placement" });

    // The hub stays until the session ends; the test card is the new message.
    expect(s.bot()).toHaveLength(2);
    expect(s.card().text).toContain("adaptive test");
    s.script.finalAfter = 2;
    await s.tap({ type: "take-test" });
    await s.answer();
    await s.answer();
    expect(s.card().text).toContain("Your level: B2");
    await s.tap({ type: "continue" });

    await s.hubOnly();
    expect((await s.settings()).settings).toMatchObject({
      cefrLevel: "B2",
      wordsPerDay: 15,
      morningTime: "09:00:00",
    });
    expect([...s.chat().values()][0]?.text).toContain("Placement test: B2.");
  });

  test("cancelling a retake leaves the level alone", async () => {
    const s = await setup();
    await s.start();
    await s.tap({ type: "lang", lang: "en" });
    await s.tap({ type: "provider", choice: "server" });
    await s.tap({ type: "know-level" });
    await s.tap({ type: "level", level: "B1" });
    await s.tap({ type: "words", count: 5 });
    await s.tap({ type: "morning", time: "08:30" });
    await s.tap({ type: "evening", time: "20:00" });
    const hub = await s.hubOnly();
    if (!hub) throw new Error("no hub");

    await s.h.press(s.telegramId, hub.messageId, encodeCallback({ type: "placement" }));
    await s.tap({ type: "cancel" });

    await s.hubOnly();
    expect((await s.settings()).settings.cefrLevel).toBe("B1");
    expect(s.script.calls).toBe(0);
  });
});
