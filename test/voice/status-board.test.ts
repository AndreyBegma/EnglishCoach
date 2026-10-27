import { describe, expect, test } from "bun:test";
import { Api } from "grammy";
import { createLogger } from "../../src/log";
import { StatusBoard, type StatusBoardStore } from "../../src/voice/status-board";

const CHAT = -100_777;

/** A Telegram API for one group chat that keeps its messages, as far as the board cares. */
function telegram() {
  const messages = new Map<number, string>();
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const pinned: number[] = [];
  let next = 1;
  const api = new Api("123:test");
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    const fail = (description: string) =>
      ({ ok: false, error_code: 400, description: `Bad Request: ${description}` }) as never;
    switch (method) {
      case "sendMessage": {
        const id = next++;
        messages.set(id, String(p.text));
        return {
          ok: true,
          result: { message_id: id, date: 0, chat: { id: CHAT, type: "supergroup" }, text: p.text },
        } as never;
      }
      case "editMessageText": {
        const id = Number(p.message_id);
        if (!messages.has(id)) return fail("message to edit not found");
        if (messages.get(id) === p.text) return fail("message is not modified");
        messages.set(id, String(p.text));
        return { ok: true, result: true } as never;
      }
      case "pinChatMessage":
        pinned.push(Number(p.message_id));
        return { ok: true, result: true } as never;
      default:
        throw new Error(`unexpected ${method}`);
    }
  });
  const count = (method: string) => calls.filter((call) => call.method === method).length;
  return { api, messages, calls, pinned, count };
}

function memoryStore() {
  const state: { id?: number } = {};
  const store: StatusBoardStore = {
    messageId: async () => state.id,
    setMessageId: async (id) => {
      state.id = id;
    },
  };
  return { store, state };
}

function setup() {
  const tg = telegram();
  const { store, state } = memoryStore();
  let now = 0;
  const board = new StatusBoard({
    api: tg.api,
    chatId: CHAT,
    store,
    log: createLogger({ write: () => {} }),
    now: () => now,
    intervalMs: 60_000,
  });
  return { tg, state, board, advance: (ms: number) => (now += ms) };
}

describe("StatusBoard with a mocked Telegram API", () => {
  test("the status is created and pinned once, then edited in place", async () => {
    const { tg, state, board, advance } = setup();
    await board.show("started", { force: true });
    expect(tg.count("sendMessage")).toBe(1);
    expect(tg.pinned).toEqual([state.id ?? -1]);
    expect(tg.calls[0]?.payload).toMatchObject({ chat_id: CHAT, disable_notification: true });

    advance(61_000);
    await board.show("half way");
    advance(61_000);
    await board.show("done", { force: true });
    expect(tg.count("sendMessage")).toBe(1);
    expect(tg.count("pinChatMessage")).toBe(1);
    expect(tg.count("editMessageText")).toBe(2);
    expect([...tg.messages.values()]).toEqual(["done"]);
  });

  test("updates while running are at most once a minute; start and end always show", async () => {
    const { tg, board, advance } = setup();
    await board.show("start", { force: true });
    advance(10_000);
    await board.show("1");
    advance(10_000);
    await board.show("2");
    expect(tg.count("editMessageText")).toBe(0);
    advance(41_000);
    await board.show("3");
    expect(tg.count("editMessageText")).toBe(1);
    advance(1_000);
    await board.show("end", { force: true });
    expect(tg.count("editMessageText")).toBe(2);
    expect([...tg.messages.values()]).toEqual(["end"]);
  });

  test("a deleted status ('message to edit not found') is re-created and re-pinned", async () => {
    const { tg, state, board } = setup();
    await board.show("one", { force: true });
    const first = state.id;
    tg.messages.clear();

    await board.show("two", { force: true });
    expect(tg.count("sendMessage")).toBe(2);
    expect(state.id).not.toBe(first);
    expect(tg.pinned).toEqual([first ?? -1, state.id ?? -1]);
    expect([...tg.messages.values()]).toEqual(["two"]);

    await board.show("three", { force: true });
    expect(tg.count("sendMessage")).toBe(2);
  });

  test("an unchanged text is not an error and does not re-create the message", async () => {
    const { tg, board } = setup();
    await board.show("same", { force: true });
    await board.show("same", { force: true });
    expect(tg.count("sendMessage")).toBe(1);
  });
});
