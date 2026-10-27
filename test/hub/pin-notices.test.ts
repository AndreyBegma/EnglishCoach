import { describe, expect, test } from "bun:test";
import { Bot, type Transformer } from "grammy";
import type { Chat, Message, Update } from "grammy/types";
import { pinNoticeCleanup } from "../../src/hub/pin-notices";
import { createLogger } from "../../src/log";
import { BOT_INFO } from "../bot/harness";

const CHAT = 7001;
const chat: Chat.PrivateChat = { id: CHAT, type: "private", first_name: "Learner" };
const learner = { id: CHAT, is_bot: false, first_name: "Learner" };
const hub = { message_id: 10, date: 0, chat, text: "hub" } as Message;

/** A bot with only the cleanup in front, over a Telegram that records deletes. */
function setup() {
  const deleted: number[] = [];
  const telegram: Transformer = async (_prev, method, payload) => {
    if (method === "deleteMessage") {
      deleted.push(Number((payload as { message_id: number }).message_id));
    }
    // biome-ignore lint/suspicious/noExplicitAny: the transformer's result type is per method.
    return { ok: true, result: true as any };
  };
  const bot = new Bot("123:test", { botInfo: BOT_INFO });
  bot.api.config.use(telegram);
  const passed: number[] = [];
  bot.use(pinNoticeCleanup(createLogger({ write: () => {} })));
  bot.on("message", (ctx) => {
    passed.push(ctx.message.message_id);
  });

  let updateId = 1;
  const deliver = (message: Partial<Message> & { message_id: number }) =>
    bot.handleUpdate({
      update_id: updateId++,
      message: { date: 0, chat, from: learner, ...message },
    } as Update);
  return { deleted, passed, deliver };
}

describe("pinNoticeCleanup", () => {
  test("deletes the bot's own pin notice and stops it reaching handlers", async () => {
    const t = setup();
    await t.deliver({ message_id: 11, from: BOT_INFO, pinned_message: hub });
    expect(t.deleted).toEqual([11]);
    expect(t.passed).toEqual([]);
  });

  test("leaves a pin the learner made alone", async () => {
    const t = setup();
    await t.deliver({ message_id: 11, pinned_message: hub });
    expect(t.deleted).toEqual([]);
    expect(t.passed).toEqual([11]);
  });

  test("never deletes a message without pinned_message, whatever its ID", async () => {
    const t = setup();
    await t.deliver({ message_id: 11, text: "typed right after the hub" });
    await t.deliver({ message_id: 12, from: BOT_INFO, text: "a bot message" });
    expect(t.deleted).toEqual([]);
    expect(t.passed).toEqual([11, 12]);
  });

  test("ignores pins outside a private chat", async () => {
    const t = setup();
    const group: Chat.GroupChat = { id: -5, type: "group", title: "g" };
    await t.deliver({ message_id: 11, chat: group, from: BOT_INFO, pinned_message: hub });
    expect(t.deleted).toEqual([]);
  });
});
