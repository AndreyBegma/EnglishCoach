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

  test("when Telegram does not deliver the notice, the next learner message clears it", async () => {
    const { h, telegramId, user, chat, hubId } = await setup({ pinUpdates: "silent" });
    await h.hub.bump(user);
    // Nothing has proven the ID after the hub yet, so the notice is still there.
    expect(chat().map((message) => message.text)).toContain(PIN_NOTICE);

    await h.say(telegramId, "/menu");
    const hub = await hubId();
    // Every earlier notice is gone; only the newest hub and its own notice remain.
    expect(chat().map((message) => message.id)).toEqual([hub, hub + 1]);
    expect(chat()[1]?.text).toBe(PIN_NOTICE);
  });
});
