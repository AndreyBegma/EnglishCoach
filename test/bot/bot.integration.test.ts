import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findActiveSession, getSession } from "../../src/db/repositories/sessions";
import { findUserByTelegramId } from "../../src/db/repositories/users";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { createHarness, type Harness } from "./harness";

const ADMIN = 900_001;

describe.skipIf(!testServerUrl)("bot with a mocked Telegram API", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  // Each test uses its own admin-like Telegram ID so they never share a hub or a session.
  let nextUser = ADMIN;
  async function setup() {
    const telegramId = nextUser++;
    const h = createHarness(database.db, { adminIds: [telegramId] });
    await h.say(telegramId, "/start");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    return { h, telegramId, user };
  }

  async function hubOf(userId: number) {
    const hub = await getHub(database.db, userId);
    if (!hub) throw new Error("no hub");
    return hub;
  }

  const chatIds = (h: Harness, telegramId: number) => [...h.telegram.chat(telegramId).keys()];

  test("/start deletes the command and sends one pinned hub; /menu moves it to the bottom", async () => {
    const { h, telegramId, user } = await setup();
    const first = await hubOf(user.id);
    expect(first).toMatchObject({ chatId: telegramId, pinned: true });
    expect(h.telegram.pinned.get(telegramId)).toBe(first.messageId);
    expect(chatIds(h, telegramId)).toEqual([first.messageId]);
    const hubMessage = h.telegram.chat(telegramId).get(first.messageId);
    expect(hubMessage?.labels.flat()).toEqual([
      "📚 Learn words",
      "🔁 Review (0)",
      "✍️ Grammar",
      "💬 Talk",
      "📈 Progress",
      "⚙️ Settings",
    ]);
    expect(h.telegram.callsOf("pinChatMessage")[0]?.payload).toMatchObject({
      disable_notification: true,
    });

    await h.say(telegramId, "/menu");
    const second = await hubOf(user.id);
    expect(second.messageId).not.toBe(first.messageId);
    expect(chatIds(h, telegramId)).toEqual([second.messageId]);
    expect(h.telegram.pinned.get(telegramId)).toBe(second.messageId);
  });

  test("hub sub-screens edit the one hub message and send nothing new", async () => {
    const { h, telegramId, user } = await setup();
    const { messageId } = await hubOf(user.id);
    h.telegram.reset();

    await h.press(telegramId, messageId, encodeCallback({ type: "settings", page: "root" }));
    expect(h.telegram.chat(telegramId).get(messageId)?.text).toContain(
      "Interface language: English",
    );

    await h.press(telegramId, messageId, encodeCallback({ type: "lang", lang: "uk" }));
    expect(h.telegram.chat(telegramId).get(messageId)?.text).toContain(
      "Мова інтерфейсу: Українська",
    );

    await h.press(telegramId, messageId, encodeCallback({ type: "screen", screen: "progress" }));
    expect(h.telegram.chat(telegramId).get(messageId)?.text).toContain("Прогрес");

    await h.press(telegramId, messageId, encodeCallback({ type: "screen", screen: "main" }));
    expect(h.telegram.chat(telegramId).get(messageId)?.text).toContain(
      "EnglishCoach — чим займемося?",
    );

    expect(h.telegram.callsOf("sendMessage")).toHaveLength(0);
    expect(h.telegram.callsOf("deleteMessage")).toHaveLength(0);
    expect(h.telegram.callsOf("editMessageText")).toHaveLength(4);
    expect(chatIds(h, telegramId)).toEqual([messageId]);
  });

  test("a finished session deletes its bot and user messages and re-sends the pinned hub", async () => {
    const { h, telegramId, user } = await setup();
    const oldHub = await hubOf(user.id);

    await h.press(
      telegramId,
      oldHub.messageId,
      encodeCallback({ type: "activity", activity: "talk" }),
    );
    const session = await findActiveSession(database.db, user.id);
    expect(session?.kind).toBe("talk");

    const sent: number[] = [];
    for (const text of ["one", "two", "three"]) sent.push(await h.say(telegramId, text));

    // During the session the chat held: the hub, the intro, 3 user messages and 3 echoes.
    const deleteBatch = h.telegram.callsOf("deleteMessages")[0]?.payload.message_ids as number[];
    expect(deleteBatch).toHaveLength(7);
    expect(deleteBatch).toEqual(expect.arrayContaining(sent));

    const newHub = await hubOf(user.id);
    expect(newHub.messageId).not.toBe(oldHub.messageId);
    expect(newHub.pinned).toBe(true);
    expect(h.telegram.pinned.get(telegramId)).toBe(newHub.messageId);
    // Only the new hub is left, and it carries the session summary.
    expect(chatIds(h, telegramId)).toEqual([newHub.messageId]);
    expect(h.telegram.chat(telegramId).get(newHub.messageId)?.text).toContain(
      "Last session: Demo finished: 3 messages echoed.",
    );

    const ended = await getSession(database.db, session?.id ?? 0);
    expect(ended).toMatchObject({ status: "finished", summaryJson: { line: expect.any(String) } });
    expect(h.timeouts.cancelled.has(session?.id ?? 0)).toBe(true);
  });

  test("an inactivity timeout expires the session and cleans up", async () => {
    const { h, telegramId, user } = await setup();
    await h.say(telegramId, "/demo");
    const session = await findActiveSession(database.db, user.id);
    if (!session) throw new Error("no session");
    await h.say(telegramId, "hello");
    // Started, then restarted by the user's message.
    expect(h.timeouts.scheduled.get(session.id)).toBe(2);

    expect(await h.sessions.expire(session.id)).toBe(true);
    // A second firing (a retried job) is a no-op.
    expect(await h.sessions.expire(session.id)).toBe(false);

    expect((await getSession(database.db, session.id))?.status).toBe("expired");
    const hub = await hubOf(user.id);
    expect(chatIds(h, telegramId)).toEqual([hub.messageId]);
    expect(h.telegram.chat(telegramId).get(hub.messageId)?.text).toContain(
      "Last session: Session closed after inactivity.",
    );
  });

  test("starting a second session offers to cancel the first", async () => {
    const { h, telegramId, user } = await setup();
    await h.say(telegramId, "/demo");
    const first = await findActiveSession(database.db, user.id);
    const hub = await hubOf(user.id);
    h.telegram.reset();

    await h.press(
      telegramId,
      hub.messageId,
      encodeCallback({ type: "activity", activity: "talk" }),
    );
    expect((await findActiveSession(database.db, user.id))?.id).toBe(first?.id ?? -1);
    const prompt = h.telegram.callsOf("sendMessage")[0];
    expect(prompt?.payload.text).toBe(
      "You have an unfinished session. Cancel it to start something new?",
    );

    const promptId = [...h.telegram.chat(telegramId).values()].find((m) =>
      m.text.startsWith("You have an unfinished session"),
    )?.id;
    await h.press(
      telegramId,
      promptId ?? 0,
      encodeCallback({ type: "session-cancel", sessionId: first?.id ?? 0 }),
    );
    expect(await findActiveSession(database.db, user.id)).toBeUndefined();
    expect((await getSession(database.db, first?.id ?? 0))?.status).toBe("cancelled");
    const newHub = await hubOf(user.id);
    expect(chatIds(h, telegramId)).toEqual([newHub.messageId]);
  });

  test("/cancel ends the active session", async () => {
    const { h, telegramId, user } = await setup();
    await h.say(telegramId, "/demo");
    await h.say(telegramId, "/cancel");
    expect(await findActiveSession(database.db, user.id)).toBeUndefined();
    const hub = await hubOf(user.id);
    expect(chatIds(h, telegramId)).toEqual([hub.messageId]);
  });

  test("a button on an old hub, or with unknown data, is answered as outdated and bumps the hub", async () => {
    const { h, telegramId, user } = await setup();
    const oldHub = await hubOf(user.id);
    await h.say(telegramId, "/menu");
    const current = await hubOf(user.id);

    h.telegram.reset();
    await h.press(telegramId, oldHub.messageId, encodeCallback({ type: "settings", page: "root" }));
    expect(h.telegram.callsOf("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "This menu is outdated.",
    });
    expect(h.telegram.callsOf("editMessageText")).toHaveLength(0);
    const bumped = await hubOf(user.id);
    expect(bumped.messageId).not.toBe(current.messageId);

    h.telegram.reset();
    await h.press(telegramId, bumped.messageId, "0:h:settings");
    expect(h.telegram.callsOf("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "This menu is outdated.",
    });
  });

  test("a hub activity without a session handler answers 'coming soon'", async () => {
    const { h, telegramId, user } = await setup();
    const hub = await hubOf(user.id);
    h.telegram.reset();
    await h.press(
      telegramId,
      hub.messageId,
      encodeCallback({ type: "activity", activity: "grammar" }),
    );
    expect(h.telegram.callsOf("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "Coming soon.",
    });
    expect(await findActiveSession(database.db, user.id)).toBeUndefined();
  });
});
