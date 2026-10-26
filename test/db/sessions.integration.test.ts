import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/client";
import {
  createSession,
  deleteSessionMessages,
  endSession,
  findActiveSession,
  lastSummaryLine,
  listSessionMessages,
  trackMessage,
} from "../../src/db/repositories/sessions";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { createTestDatabase, testServerUrl } from "./test-database";

describe.skipIf(!testServerUrl)("sessions repository", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  test("only one active session per user, even when started concurrently", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 6001 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createSession(database.db, user.id, "talk")),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const active = await findActiveSession(database.db, user.id);
    for (const result of results) {
      if (!result.created) expect(result.active.id).toBe(active?.id ?? -1);
    }
  });

  test("tracks messages in order and deletes them", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 6002 });
    const start = await createSession(database.db, user.id, "talk");
    if (!start.created) throw new Error("expected a new session");
    await trackMessage(database.db, start.session.id, 42, 10);
    await trackMessage(database.db, start.session.id, 42, 11);

    const tracked = await listSessionMessages(database.db, start.session.id);
    expect(tracked.map((m) => [m.chatId, m.messageId])).toEqual([
      [42, 10],
      [42, 11],
    ]);

    await deleteSessionMessages(database.db, start.session.id);
    expect(await listSessionMessages(database.db, start.session.id)).toEqual([]);
  });

  test("ending is one-shot and the summary line becomes the user's last summary", async () => {
    const user = await getOrCreateUser(database.db, { telegramId: 6003 });
    expect(await lastSummaryLine(database.db, user.id)).toBeUndefined();

    const start = await createSession(database.db, user.id, "talk");
    if (!start.created) throw new Error("expected a new session");

    const [first, second] = await Promise.all([
      endSession(database.db, start.session.id, "finished", { line: "3 words learned" }),
      endSession(database.db, start.session.id, "expired", null),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await findActiveSession(database.db, user.id)).toBeUndefined();

    const winner = first ?? second;
    if (winner?.status === "finished") {
      expect(await lastSummaryLine(database.db, user.id)).toBe("3 words learned");
    } else {
      expect(await lastSummaryLine(database.db, user.id)).toBeUndefined();
    }
  });
});
