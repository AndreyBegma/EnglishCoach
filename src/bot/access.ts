import { Composer, type MiddlewareFn } from "grammy";
import type Redis from "ioredis";
import type { Db } from "../db/client";
import {
  findUserByTelegramId,
  getOrCreateUser,
  getSettings,
  listAllowedUsers,
  setAllowed,
} from "../db/repositories/users";
import type { Logger } from "../log";
import type { BotContext } from "./context";
import { localeFromLanguageCode, type Translator } from "./i18n";

/** Decides whether a refused user gets the refusal text this time. */
export interface RefusalGate {
  /** True the first time per window for a Telegram ID. */
  shouldNotify(telegramId: number): Promise<boolean>;
}

export const REFUSAL_WINDOW_SECONDS = 24 * 60 * 60;

/** One refusal per Telegram ID per 24 hours, across restarts and instances. */
export function redisRefusalGate(client: Redis): RefusalGate {
  return {
    async shouldNotify(telegramId) {
      const reply = await client.set(
        `refused:${telegramId}`,
        "1",
        "EX",
        REFUSAL_WINDOW_SECONDS,
        "NX",
      );
      return reply === "OK";
    },
  };
}

export interface AccessDeps {
  db: Db;
  adminIds: readonly number[];
  refusals: RefusalGate;
  i18n: Translator;
  log: Logger;
}

/**
 * Allowlist (docs/ARCHITECTURE.md → Access). Admins from env always pass; everyone else needs
 * `users.is_allowed`. Nothing is written for a refused user — only a log line. On success sets
 * `ctx.user`, `ctx.settings` and `ctx.isAdmin`.
 */
export function accessMiddleware(deps: AccessDeps): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const from = ctx.from;
    if (!from || from.is_bot) return;
    const isAdmin = deps.adminIds.includes(from.id);

    const known = isAdmin ? undefined : await findUserByTelegramId(deps.db, from.id);
    if (!isAdmin && !known?.isAllowed) {
      deps.log.info("access refused", { telegramId: from.id });
      await refuse(ctx, deps, from.id);
      return;
    }

    const user = await getOrCreateUser(deps.db, {
      telegramId: from.id,
      username: from.username,
      firstName: from.first_name,
      lang: localeFromLanguageCode(from.language_code),
    });
    const settings = await getSettings(deps.db, user.id);
    if (!settings) throw new Error(`user ${user.id} has no settings after getOrCreateUser`);

    ctx.user = user;
    ctx.settings = settings;
    ctx.isAdmin = isAdmin;
    await next();
  };
}

async function refuse(ctx: BotContext, deps: AccessDeps, telegramId: number) {
  const text = deps.i18n.t(localeFromLanguageCode(ctx.from?.language_code), "access-denied");
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text });
    return;
  }
  if (ctx.chat?.type !== "private") return;
  // Fail open on Redis trouble: one extra refusal is better than silence.
  const notify = await deps.refusals.shouldNotify(telegramId).catch(() => true);
  if (notify) await ctx.reply(text);
}

/** `/allow <id>`, `/deny <id>`, `/users` — admins only; for anyone else they do not exist. */
export function adminCommands(db: Db): Composer<BotContext> {
  const composer = new Composer<BotContext>();
  const admin = composer.filter((ctx) => ctx.isAdmin);

  const parseId = (match: string) => {
    const value = match.trim();
    return /^\d{1,15}$/.test(value) ? Number(value) : undefined;
  };

  admin.command("allow", async (ctx) => {
    const id = parseId(ctx.match);
    if (id === undefined) return void (await ctx.reply(ctx.t("admin-allow-usage")));
    await setAllowed(db, id, true);
    await ctx.reply(ctx.t("admin-allowed", { id: String(id) }));
  });

  admin.command("deny", async (ctx) => {
    const id = parseId(ctx.match);
    if (id === undefined) return void (await ctx.reply(ctx.t("admin-deny-usage")));
    const user = await setAllowed(db, id, false);
    await ctx.reply(ctx.t(user ? "admin-denied" : "admin-unknown-user", { id: String(id) }));
  });

  admin.command("users", async (ctx) => {
    const users = await listAllowedUsers(db);
    if (users.length === 0) return void (await ctx.reply(ctx.t("admin-users-empty")));
    const lines = users.map((user) =>
      [user.telegramId, user.username && `@${user.username}`, user.firstName]
        .filter(Boolean)
        .join(" · "),
    );
    await ctx.reply([ctx.t("admin-users-title"), ...lines].join("\n"));
  });

  return composer;
}
