import { describe, expect, test } from "bun:test";
import { Api, InlineKeyboard } from "grammy";
import type { BotContext, FlowState } from "../../src/bot/context";
import { createLogger } from "../../src/log";
import { SessionWindows } from "../../src/sessions/window";
import { FakeTelegram } from "../bot/harness";

const CHAT = 4242;
const SESSION = 7;

function setup(noteTtlMs = 60_000) {
  const telegram = new FakeTelegram();
  const api = new Api("123:test");
  api.config.use(telegram.transformer);
  const windows = new SessionWindows({
    api,
    log: createLogger({ level: "debug", write: () => {} }),
    noteTtlMs,
  });
  const tracked: number[] = [];
  const open = (ctx?: BotContext, on = windows) =>
    on.open(SESSION, CHAT, async (id) => void tracked.push(id), ctx);
  const chat = () => [...telegram.chat(CHAT).values()];
  return { telegram, api, windows, tracked, open, chat };
}

const keyboard = (label: string) => new InlineKeyboard().text(label, label);

describe("SessionWindow", () => {
  test("text steps edit one message in place, and every edit replaces the keyboard", async () => {
    const { open, chat, tracked, telegram } = setup();
    const window = open();
    const id = await window.show({ text: "card", reply_markup: keyboard("got it") });
    expect(await window.show({ text: "exercise", reply_markup: keyboard("a") })).toBe(id);
    expect(chat()).toMatchObject([{ id, text: "exercise", buttons: [["a"]] }]);

    // A step without buttons leaves none to tap.
    await window.show({ text: "result" });
    expect(chat()).toMatchObject([{ id, text: "result", buttons: [] }]);
    // Showing the same screen again is not an error.
    await window.show({ text: "result" });
    expect(tracked).toEqual([id]);
    expect(telegram.callsOf("sendMessage")).toHaveLength(1);
  });

  test("a media switch replaces the window: the new one is sent, then the old one deleted", async () => {
    const { open, chat, telegram } = setup();
    const window = open();
    const text = await window.show({ text: "card" });

    const photo = await window.show({
      photo: "file-1",
      caption: "<b>decide</b>",
      parse_mode: "HTML",
    });
    expect(photo).not.toBe(text);
    expect(chat()).toMatchObject([{ id: photo, photo: "file-1", text: "<b>decide</b>" }]);
    const sent = telegram.calls.findIndex((c) => c.method === "sendPhoto");
    const deleted = telegram.calls.findIndex((c) => c.method === "deleteMessage");
    expect(sent).toBeLessThan(deleted);

    // Photo → photo is an edit of the media.
    expect(await window.show({ photo: "file-2", caption: "borrow" })).toBe(photo);
    expect(chat()).toMatchObject([{ id: photo, photo: "file-2", text: "borrow" }]);
    expect(telegram.callsOf("editMessageMedia")).toHaveLength(1);

    // And back to text: replaced again, no duplicates left.
    const back = await window.show({ text: "exercise" });
    expect(chat()).toMatchObject([{ id: back, text: "exercise" }]);
    expect(chat()[0]?.photo).toBeUndefined();
  });

  test("a window the learner deleted is sent again; `fresh` re-sends it at the bottom", async () => {
    const { open, chat, telegram } = setup();
    const window = open();
    const first = await window.show({ text: "one" });
    telegram.chat(CHAT).delete(first);
    const second = await window.show({ text: "two" });
    expect(second).not.toBe(first);
    expect(chat().map((m) => m.text)).toEqual(["two"]);

    const below = telegram.userMessage(CHAT, "/start");
    const third = await window.show({ text: "two" }, { fresh: true });
    expect(chat().map((m) => m.id)).toEqual([below, third]);
  });

  test("attachments of a step (a voice note) are deleted when the next step shows", async () => {
    const { open, chat, telegram } = setup();
    const window = open();
    const id = await window.show({ text: "card" });
    const voice = telegram.userMessage(CHAT, "🔊");
    await window.attach(voice);
    expect(chat().map((m) => m.id)).toEqual([id, voice]);
    await window.show({ text: "exercise" });
    expect(chat().map((m) => m.id)).toEqual([id]);
  });

  test("a flash note replaces the previous one and fades on its own", async () => {
    const { open, chat, windows } = setup(5);
    const window = open();
    await window.show({ text: "card" });
    await window.flashNote("use the buttons");
    await window.flashNote("use the buttons");
    expect(chat().map((m) => m.text)).toEqual(["card", "use the buttons"]);
    await Bun.sleep(30);
    expect(chat().map((m) => m.text)).toEqual(["card"]);

    await window.flashNote("again");
    await windows.flushNotes();
    expect(chat().map((m) => m.text)).toEqual(["card"]);
  });

  test("the learner's message is deleted once read", async () => {
    const { open, chat, telegram } = setup();
    const id = telegram.userMessage(CHAT, "borow");
    await open().consumeUserMessage(id);
    expect(chat()).toEqual([]);
    // Already gone: not an error.
    await open().consumeUserMessage(id);
  });

  test("after a restart the window found in grammY's session is edited, not stacked", async () => {
    const first = setup();
    const session: FlowState = {};
    const ctx = { session } as BotContext;
    const id = await first.open(ctx).show({ text: "card" });
    expect(session.window).toMatchObject({ sessionId: SESSION, messageId: id, media: "text" });

    // A new process: nothing in memory, the stored state still names the window.
    const restarted = new SessionWindows({
      api: first.api,
      log: createLogger({ level: "debug", write: () => {} }),
    });
    expect(await first.open(ctx, restarted).show({ text: "exercise" })).toBe(id);
    expect(first.chat().map((m) => m.text)).toEqual(["exercise"]);

    // Another session's state is not this window.
    session.window = { sessionId: SESSION + 1, messageId: id, media: "text", attachments: [] };
    const other = new SessionWindows({
      api: first.api,
      log: createLogger({ level: "debug", write: () => {} }),
    });
    expect(first.open(ctx, other).messageId).toBeUndefined();
  });
});
