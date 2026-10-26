import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createI18n } from "../../src/bot/i18n";
import type { Database } from "../../src/db/client";
import { findActiveSession, lastSummaryLine } from "../../src/db/repositories/sessions";
import { getOrCreateUser } from "../../src/db/repositories/users";
import { createLogger } from "../../src/log";
import {
  type LearningHandle,
  type SessionEnded,
  SessionManager,
} from "../../src/sessions/session-manager";
import { createHarness, FakeTimeouts } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

describe.skipIf(!testServerUrl)("session sequences", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  /** `review` ends at once when `emptyReview`, like a review with nothing due. */
  function manager(options: { emptyReview?: boolean } = {}) {
    const h = createHarness(database.db);
    const sessions = new SessionManager({
      api: h.bot.api,
      db: database.db,
      hub: h.hub,
      timeouts: new FakeTimeouts(),
      log: createLogger({ write: () => {} }),
      i18n: createI18n(),
    });
    const started: LearningHandle[] = [];
    sessions.register("review", {
      async onStart(handle) {
        started.push(handle);
        if (options.emptyReview) await handle.end("finished", { line: "nothing due" });
        else await handle.send("review question");
      },
    });
    sessions.register("vocab_new", {
      async onStart(handle) {
        started.push(handle);
        await handle.send("new word");
      },
    });
    const ended: SessionEnded[] = [];
    sessions.onEnded((event) => {
      ended.push(event);
    });
    return { h, sessions, started, ended };
  }

  let nextTelegramId = 8301;
  const newUser = () => getOrCreateUser(database.db, { telegramId: nextTelegramId++ });

  test("a finished part starts the next one; the hub gets every part's line", async () => {
    const { h, sessions, started, ended } = manager();
    const user = await newUser();

    const outcome = await sessions.startSequence(user, ["review", "vocab_new"]);
    expect(outcome.started).toBe(true);
    await started[0]?.end("finished", { line: "3 reviewed" });

    expect(started.map((handle) => handle.session.kind)).toEqual(["review", "vocab_new"]);
    expect((await findActiveSession(database.db, user.id))?.kind).toBe("vocab_new");
    // The first part's message is gone, and no hub came back between the parts.
    const texts = [...h.telegram.chat(user.telegramId).values()].map((m) => m.text);
    expect(texts).toEqual(["new word"]);

    await started[1]?.end("finished", { line: "2 new words" });
    expect(await lastSummaryLine(database.db, user.id)).toBe("3 reviewed\n2 new words");
    expect(h.telegram.pinned.get(user.telegramId)).toBeDefined();
    expect(ended.map((event) => [event.session.kind, event.status])).toEqual([
      ["review", "finished"],
      ["vocab_new", "finished"],
    ]);
  });

  test("a part that ends inside onStart still hands over to the next", async () => {
    const { sessions, started } = manager({ emptyReview: true });
    const user = await newUser();

    await sessions.startSequence(user, ["review", "vocab_new"]);
    expect((await findActiveSession(database.db, user.id))?.kind).toBe("vocab_new");
    await started[1]?.end("finished", { line: "5 new words" });
    expect(await lastSummaryLine(database.db, user.id)).toBe("nothing due\n5 new words");
  });

  test("cancelling a part ends the sequence", async () => {
    const { sessions, started } = manager();
    const user = await newUser();

    await sessions.startSequence(user, ["review", "vocab_new"]);
    await started[0]?.end("cancelled");

    expect(started).toHaveLength(1);
    expect(await findActiveSession(database.db, user.id)).toBeUndefined();
  });

  test("continueWith turns a started session into the first part of a sequence", async () => {
    const { sessions, started } = manager();
    const user = await newUser();

    const outcome = await sessions.start(user, "review");
    if (!outcome.started) throw new Error("review did not start");
    await sessions.continueWith(outcome.handle.session.id, ["vocab_new"]);
    await started[0]?.end("finished", { line: "4 reviewed" });

    expect((await findActiveSession(database.db, user.id))?.kind).toBe("vocab_new");
    await started[1]?.end("finished", { line: "1 new word" });
    expect(await lastSummaryLine(database.db, user.id)).toBe("4 reviewed\n1 new word");

    // On a session that is over it does nothing.
    await sessions.continueWith(outcome.handle.session.id, ["vocab_new"]);
    expect(await findActiveSession(database.db, user.id)).toBeUndefined();
  });

  test("a plain start is not a sequence", async () => {
    const { sessions, started } = manager();
    const user = await newUser();

    await sessions.start(user, "review");
    await started[0]?.end("finished", { line: "done" });

    expect(started).toHaveLength(1);
    expect(await lastSummaryLine(database.db, user.id)).toBe("done");
  });
});
