import { MemorySessionStorage, type Transformer } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import type { RefusalGate } from "../../src/bot/access";
import type { FlowState } from "../../src/bot/context";
import { createBot } from "../../src/bot/index";
import type { Db } from "../../src/db/client";
import type { ProviderFactories } from "../../src/llm";
import { createLogger } from "../../src/log";
import type { SessionTimeouts } from "../../src/sessions/session-manager";
import { FakeLlm } from "./fake-llm";

export const BOT_INFO: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: "Coach",
  username: "coach_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

type Payload = Record<string, unknown>;
export type ApiCall = { method: string; payload: Payload };

export interface ChatMessage {
  id: number;
  from: "bot" | "user";
  text: string;
  /** Callback data of every inline button, row by row. */
  buttons: string[][];
  /** Button labels, row by row. */
  labels: string[][];
}

type Markup = { inline_keyboard?: { text: string; callback_data?: string }[][] };

/**
 * An in-memory Telegram: answers the Bot API calls the bot makes and keeps what a private chat
 * would show, so tests can assert on the chat as well as on the calls.
 */
export class FakeTelegram {
  readonly calls: ApiCall[] = [];
  /** chatId → messageId → message. */
  readonly chats = new Map<number, Map<number, ChatMessage>>();
  readonly pinned = new Map<number, number>();
  private nextId = 100;

  chat(chatId: number): Map<number, ChatMessage> {
    let chat = this.chats.get(chatId);
    if (!chat) {
      chat = new Map();
      this.chats.set(chatId, chat);
    }
    return chat;
  }

  /** A message the user typed; returns its ID. */
  userMessage(chatId: number, text: string): number {
    const id = this.nextId++;
    this.chat(chatId).set(id, { id, from: "user", text, buttons: [], labels: [] });
    return id;
  }

  callsOf(method: string): ApiCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  reset(): void {
    this.calls.length = 0;
  }

  readonly transformer: Transformer = async (_prev, method, payload) => {
    const p = (payload ?? {}) as Payload;
    this.calls.push({ method, payload: p });
    const chatId = Number(p.chat_id);
    // biome-ignore lint/suspicious/noExplicitAny: the transformer's result type is per method.
    const ok = (result: unknown) => ({ ok: true as const, result: result as any });
    const fail = (description: string) => ({
      ok: false as const,
      error_code: 400,
      description: `Bad Request: ${description}`,
    });

    switch (method) {
      case "sendMessage": {
        const id = this.nextId++;
        const markup = p.reply_markup as Markup | undefined;
        this.chat(chatId).set(id, {
          id,
          from: "bot",
          text: String(p.text),
          ...keyboardOf(markup),
        });
        return ok({
          message_id: id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, type: "private", first_name: "Learner" },
          from: BOT_INFO,
          text: p.text,
        });
      }
      case "editMessageText": {
        const message = this.chat(chatId).get(Number(p.message_id));
        if (!message) return fail("message to edit not found");
        const next = keyboardOf(p.reply_markup as Markup | undefined);
        if (
          message.text === p.text &&
          JSON.stringify(message.buttons) === JSON.stringify(next.buttons)
        ) {
          return fail("message is not modified");
        }
        Object.assign(message, { text: String(p.text) }, next);
        return ok({
          message_id: message.id,
          date: 0,
          chat: { id: chatId, type: "private", first_name: "Learner" },
          text: p.text,
        });
      }
      case "deleteMessage": {
        if (!this.chat(chatId).delete(Number(p.message_id))) {
          return fail("message to delete not found");
        }
        return ok(true);
      }
      case "deleteMessages": {
        for (const id of p.message_ids as number[]) this.chat(chatId).delete(id);
        return ok(true);
      }
      case "pinChatMessage":
        this.pinned.set(chatId, Number(p.message_id));
        return ok(true);
      case "answerCallbackQuery":
        return ok(true);
      default:
        throw new Error(`FakeTelegram: unexpected API call ${method}`);
    }
  };
}

function keyboardOf(markup: Markup | undefined) {
  const rows = markup?.inline_keyboard ?? [];
  return {
    buttons: rows.map((row) => row.map((button) => button.callback_data ?? "")),
    labels: rows.map((row) => row.map((button) => button.text)),
  };
}

/** Timeouts the test fires by hand. */
export class FakeTimeouts implements SessionTimeouts {
  readonly scheduled = new Map<number, number>();
  readonly cancelled = new Set<number>();
  async schedule(sessionId: number) {
    this.scheduled.set(sessionId, (this.scheduled.get(sessionId) ?? 0) + 1);
  }
  async cancel(sessionId: number) {
    this.scheduled.delete(sessionId);
    this.cancelled.add(sessionId);
  }
}

export class MemoryRefusalGate implements RefusalGate {
  readonly seen = new Set<number>();
  async shouldNotify(telegramId: number) {
    if (this.seen.has(telegramId)) return false;
    this.seen.add(telegramId);
    return true;
  }
}

export interface HarnessOptions {
  adminIds?: number[];
  enableDemoSession?: boolean;
  /** Replaces the fake LLM, e.g. with the real providers over fake SDK clients. */
  llmFactories?: ProviderFactories;
}

/** A fixed 32-byte master key; tests decrypt stored keys with it. */
export const TEST_MASTER_KEY = Buffer.alloc(32, 7);

export function createHarness(db: Db, options: HarnessOptions = {}) {
  const telegram = new FakeTelegram();
  const timeouts = new FakeTimeouts();
  const refusals = new MemoryRefusalGate();
  const llm = new FakeLlm();
  const logs: string[] = [];
  const app = createBot({
    token: "123:test",
    db,
    log: createLogger({ level: "debug", write: (line) => logs.push(line) }),
    adminIds: options.adminIds ?? [],
    storage: new MemorySessionStorage<FlowState>(),
    refusals,
    timeouts,
    enableDemoSession: options.enableDemoSession ?? true,
    masterKey: TEST_MASTER_KEY,
    llmEnv: {
      SERVER_LLM_PROVIDER: "anthropic",
      SERVER_ANTHROPIC_API_KEY: "server-key",
      CLAUDE_BIN: "claude",
    },
    llmFactories: options.llmFactories ?? llm.factories,
    botConfig: { botInfo: BOT_INFO },
  });
  app.bot.api.config.use(telegram.transformer);

  let updateId = 1;
  const user = (id: number, languageCode = "en") => ({
    id,
    is_bot: false,
    first_name: `User${id}`,
    username: `user${id}`,
    language_code: languageCode,
  });

  const send = (update: Omit<Update, "update_id">) =>
    app.bot.handleUpdate({ update_id: updateId++, ...update } as Update);

  return {
    ...app,
    telegram,
    timeouts,
    refusals,
    llm,
    /** Every log line the bot wrote, as JSON text. */
    logs,
    /** The user shares a location. Returns the message ID. */
    async shareLocation(from: number, latitude: number, longitude: number): Promise<number> {
      const id = telegram.userMessage(from, "");
      await send({
        message: {
          message_id: id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: from, type: "private", first_name: `User${from}` },
          from: user(from),
          location: { latitude, longitude },
        },
      });
      return id;
    },
    /** The user types `text` (a command if it starts with `/`). Returns the message ID. */
    async say(from: number, text: string, languageCode?: string): Promise<number> {
      const id = telegram.userMessage(from, text);
      const command = text.startsWith("/") ? text.split(/\s/)[0] : undefined;
      await send({
        message: {
          message_id: id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: from, type: "private", first_name: `User${from}` },
          from: user(from, languageCode),
          text,
          ...(command
            ? { entities: [{ type: "bot_command", offset: 0, length: command.length }] }
            : {}),
        },
      });
      return id;
    },
    /** The user presses a button with `data` on message `messageId`. */
    async press(from: number, messageId: number, data: string): Promise<void> {
      const message = telegram.chat(from).get(messageId);
      await send({
        callback_query: {
          id: String(updateId),
          from: user(from),
          chat_instance: "test",
          data,
          message: {
            message_id: messageId,
            date: 0,
            chat: { id: from, type: "private", first_name: `User${from}` },
            from: BOT_INFO,
            text: message?.text ?? "",
          },
        },
      });
    },
  };
}

export type Harness = ReturnType<typeof createHarness>;
