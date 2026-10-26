import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import { findUserByTelegramId } from "../../src/db/repositories/users";
import { createTestDatabase, testServerUrl } from "../db/test-database";
import { createHarness } from "./harness";

const ADMIN = 800_001;
const STRANGER = 800_002;
const FRIEND = 800_003;

describe.skipIf(!testServerUrl)("allowlist", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  const replies = (h: ReturnType<typeof createHarness>, chatId: number) =>
    h.telegram
      .callsOf("sendMessage")
      .filter((call) => call.payload.chat_id === chatId)
      .map((call) => call.payload.text);

  test("an unknown user gets one localized refusal and nothing is stored", async () => {
    const h = createHarness(database.db, { adminIds: [ADMIN] });
    await h.say(STRANGER, "/start", "ru");
    await h.say(STRANGER, "hello?", "ru");

    expect(replies(h, STRANGER)).toEqual([
      "Извините, это закрытый бот. Попросите владельца добавить вас.",
    ]);
    expect(await findUserByTelegramId(database.db, STRANGER)).toBeUndefined();
  });

  test("a refused user pressing a button gets the refusal as a toast", async () => {
    const h = createHarness(database.db, { adminIds: [ADMIN] });
    await h.press(STRANGER, 1, "1:h:main");
    expect(h.telegram.callsOf("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "Sorry, this bot is private. Ask its owner to add you.",
    });
    expect(h.telegram.callsOf("sendMessage")).toHaveLength(0);
  });

  test("an admin is always allowed and is created with their Telegram language", async () => {
    const ukAdmin = 800_010;
    const h = createHarness(database.db, { adminIds: [ukAdmin] });
    await h.say(ukAdmin, "/menu", "uk");
    expect(await findUserByTelegramId(database.db, ukAdmin)).toBeDefined();
    expect(replies(h, ukAdmin)[0]).toContain("EnglishCoach — чим займемося?");

    // The stored language wins over a later Telegram language_code.
    await h.say(ukAdmin, "/menu", "en");
    expect(replies(h, ukAdmin)[1]).toContain("EnglishCoach — чим займемося?");
  });

  test("/allow, /users and /deny control who gets in", async () => {
    const h = createHarness(database.db, { adminIds: [ADMIN] });

    await h.say(ADMIN, "/allow");
    await h.say(ADMIN, `/allow ${FRIEND}`);
    await h.say(ADMIN, "/users");
    expect(replies(h, ADMIN).slice(-3)).toEqual([
      "Usage: /allow <Telegram ID>",
      `User ${FRIEND} is allowed.`,
      `Allowed users:\n${FRIEND}`,
    ]);

    await h.say(FRIEND, "/menu");
    const friend = await findUserByTelegramId(database.db, FRIEND);
    expect(friend).toMatchObject({ isAllowed: true, username: `user${FRIEND}` });
    expect(replies(h, FRIEND)[0]).toContain("EnglishCoach — what shall we do?");

    await h.say(ADMIN, `/deny ${FRIEND}`);
    await h.say(ADMIN, "/deny 12345");
    expect(replies(h, ADMIN).slice(-2)).toEqual([
      `User ${FRIEND} is no longer allowed.`,
      "User 12345 is not known.",
    ]);

    const before = replies(h, FRIEND).length;
    await h.say(FRIEND, "/menu");
    expect(replies(h, FRIEND).slice(before)).toEqual([
      "Sorry, this bot is private. Ask its owner to add you.",
    ]);
  });

  test("admin commands do nothing for a non-admin", async () => {
    const h = createHarness(database.db, { adminIds: [ADMIN] });
    await h.say(ADMIN, `/allow ${FRIEND}`);
    h.telegram.reset();
    await h.say(FRIEND, `/allow ${STRANGER}`);
    expect(h.telegram.callsOf("sendMessage")).toHaveLength(0);
    expect(await findUserByTelegramId(database.db, STRANGER)).toBeUndefined();
  });
});
