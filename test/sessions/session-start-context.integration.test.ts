import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { BotContext } from "../../src/bot/context";
import { createI18n } from "../../src/bot/i18n";
import type { Database } from "../../src/db/client";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { createLogger } from "../../src/log";
import { type LearningHandle, SessionManager } from "../../src/sessions/session-manager";
import { createHarness, FakeTimeouts } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

describe.skipIf(!testServerUrl)("onStart receives the update that started the session", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  function manager() {
    const h = createHarness(database.db);
    const sessions = new SessionManager({
      api: h.bot.api,
      db: database.db,
      hub: h.hub,
      timeouts: new FakeTimeouts(),
      log: createLogger({ write: () => {} }),
      i18n: createI18n(),
    });
    const seen: (BotContext | undefined)[] = [];
    const handles: LearningHandle[] = [];
    sessions.register("routine_evening", {
      async onStart(handle, ctx) {
        handles.push(handle);
        seen.push(ctx);
      },
    });
    return { sessions, seen, handles };
  }

  const fakeCtx = (userId: number) => ({ user: { id: userId } }) as unknown as BotContext;

  test("inside an update, from the update; outside one, none; another user's, none", async () => {
    const { sessions, seen, handles } = manager();
    const user = await getOrCreateUser(database.db, { telegramId: 8201 });
    const other = await getOrCreateUser(database.db, { telegramId: 8202 });
    const ctx = fakeCtx(user.id);

    await sessions.inUpdate(ctx, () => sessions.start(user, "routine_evening"));
    await handles[0]?.end("finished");
    await sessions.start(user, "routine_evening");
    await handles[1]?.end("finished");
    await sessions.inUpdate(fakeCtx(other.id), () => sessions.start(user, "routine_evening"));
    await handles[2]?.end("finished");

    expect(seen).toEqual([ctx, undefined, undefined]);
  });

  test("an explicit ctx wins over the update being handled", async () => {
    const { sessions, seen } = manager();
    const user = await getOrCreateUser(database.db, { telegramId: 8203 });
    const explicit = fakeCtx(user.id);
    await sessions.inUpdate(fakeCtx(user.id), () =>
      sessions.start(user, "routine_evening", explicit),
    );
    expect(seen[0]).toBe(explicit);
  });
});
