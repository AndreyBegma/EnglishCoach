import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { findUserByTelegramId } from "../../src/db/repositories/users";
import { createHarness, type HarnessOptions, PIN_NOTICE } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

describe.skipIf(!testServerUrl)("pin notices with a mocked Telegram API", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  let nextUser = 930_001;
  async function setup(options: HarnessOptions = {}) {
    const telegramId = nextUser++;
    const h = createHarness(database.db, { ...options, adminIds: [telegramId] });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    if (!user) throw new Error("user not created");
    const chat = () => [...h.telegram.chat(telegramId).values()];
    const hubId = async () => (await getHub(database.db, user.id))?.messageId ?? 0;
    return { h, telegramId, user, chat, hubId };
  }

  test("after a hub bump the chat holds exactly the pinned hub", async () => {
    const { h, telegramId, user, chat, hubId } = await setup();
    expect(chat().map((message) => message.id)).toEqual([await hubId()]);

    await h.hub.bump(user);
    const bumped = await hubId();
    expect(chat().map((message) => message.id)).toEqual([bumped]);
    expect(h.telegram.pinned.get(telegramId)).toBe(bumped);
  });

  test("when Telegram does not deliver the notice, nothing is deleted on a guess", async () => {
    const { h, telegramId, user, chat, hubId } = await setup({ pinUpdates: "silent" });
    h.telegram.reset();
    await h.hub.bump(user);
    const typed = await h.say(telegramId, "hello");

    // The notice stays: its ID cannot be verified, so the bot leaves it.
    const hub = await hubId();
    expect(chat().find((message) => message.id === hub + 1)?.text).toBe(PIN_NOTICE);
    // Only the old hub was deleted; never the notice and never the learner's message.
    const deleted = h.telegram.callsOf("deleteMessage").map((call) => call.payload.message_id);
    expect(deleted).not.toContain(hub + 1);
    expect(deleted).not.toContain(typed);
  });
});
