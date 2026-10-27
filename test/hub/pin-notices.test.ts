import { describe, expect, test } from "bun:test";
import { Bot, type Transformer } from "grammy";
import type { Message, Update } from "grammy/types";
import { PinNotices } from "../../src/hub/pin-notices";
import { createLogger } from "../../src/log";
import { BOT_INFO } from "../bot/harness";

const CHAT = 7001;
const chat = { id: CHAT, type: "private" as const, first_name: "Learner" };
const learner = { id: CHAT, is_bot: false, first_name: "Learner" };

/** A bot with only PinNotices in front, over a Telegram that records deletes and numbers sends. */
function setup() {
  const deleted: number[] = [];
  let sendId = 0;
  const telegram: Transformer = async (_prev, method, payload) => {
    if (method === "deleteMessage")
      deleted.push(Number((payload as { message_id: number }).message_id));
    // biome-ignore lint/suspicious/noExplicitAny: the transformer's result type is per method.
    const result: any = method === "sendMessage" ? { message_id: sendId, chat, date: 0 } : true;
    return { ok: true, result };
  };
  const bot = new Bot("123:test", { botInfo: BOT_INFO });
  bot.api.config.use(telegram);
  const pins = new PinNotices({
    api: bot.api,
    log: createLogger({ write: () => {} }),
    settleMs: 0,
  });
  bot.api.config.use(pins.transformer);
  const passed: number[] = [];
  bot.use(pins.middleware());
  bot.on("message", (ctx) => {
    passed.push(ctx.message.message_id);
  });

  let updateId = 1;
  const deliver = async (message: Partial<Message> & { message_id: number }) => {
    await bot.handleUpdate({
      update_id: updateId++,
      message: { date: 0, chat, from: learner, ...message },
    } as Update);
    await pins.idle();
  };
  return {
    bot,
    pins,
    deleted,
    passed,
    /** The learner types; the message has ID `id`. */
    say: (id: number) => deliver({ message_id: id, text: "hi" }),
    deliver,
    /** The bot sends a message that Telegram numbers `id`. */
    send: async (id: number) => {
      sendId = id;
      await bot.api.sendMessage(CHAT, "window");
    },
  };
}

describe("PinNotices", () => {
  test("deletes the bot's own pin notice when Telegram delivers it, and stops it reaching handlers", async () => {
    const t = setup();
    t.pins.pinned(CHAT, 10);
    await t.deliver({
      message_id: 11,
      from: BOT_INFO,
      pinned_message: { message_id: 10, date: 0, chat, text: "hub" } as Message,
    });
    expect(t.deleted).toEqual([11]);
    expect(t.passed).toEqual([]);

    // The pin is settled: a later message deletes nothing more.
    await t.say(12);
    expect(t.deleted).toEqual([11]);
  });

  test("a notice delivered before pinChatMessage returned is not chased again", async () => {
    const t = setup();
    await t.deliver({
      message_id: 11,
      from: BOT_INFO,
      pinned_message: { message_id: 10, date: 0, chat, text: "hub" } as Message,
    });
    t.pins.pinned(CHAT, 10);
    await t.say(12);
    await t.say(13);
    expect(t.deleted).toEqual([11]);
  });

  test("leaves a pin the learner made alone", async () => {
    const t = setup();
    await t.deliver({
      message_id: 11,
      pinned_message: { message_id: 5, date: 0, chat, text: "mine" } as Message,
    });
    expect(t.deleted).toEqual([]);
    expect(t.passed).toEqual([11]);
  });

  test("without the update, the next learner message proves the ID after the hub and deletes it", async () => {
    const t = setup();
    t.pins.pinned(CHAT, 10);
    expect(t.deleted).toEqual([]);
    await t.say(12);
    expect(t.deleted).toEqual([11]);
    expect(t.passed).toEqual([12]);
  });

  test("never deletes a learner message that took the ID after the hub", async () => {
    const t = setup();
    t.pins.pinned(CHAT, 10);
    await t.say(11); // typed between sendMessage and pinChatMessage: the notice is 12
    expect(t.deleted).toEqual([]);
    await t.say(13);
    expect(t.deleted).toEqual([12]);
  });

  test("never deletes a bot message that took the ID after the hub", async () => {
    const t = setup();
    await t.send(11); // a session window sent while the pin was in flight
    t.pins.pinned(CHAT, 10);
    await t.send(13);
    // A bot send proves nothing about learner messages still in flight.
    expect(t.deleted).toEqual([]);
    await t.say(14);
    expect(t.deleted).toEqual([12]);
  });

  test("a learner message for an ID not yet past the candidate proves nothing", async () => {
    const t = setup();
    t.pins.pinned(CHAT, 10);
    await t.say(11);
    await t.say(12);
    // 11 and 12 are the learner's; the notice must be above them and nothing has passed it yet.
    expect(t.deleted).toEqual([]);
    await t.say(14);
    expect(t.deleted).toEqual([13]);
  });
});
