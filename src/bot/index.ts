import { Bot } from "grammy";
import { type BotContext, createI18n } from "./i18n";

export function createBot(token: string) {
  const bot = new Bot<BotContext>(token);
  bot.use(createI18n());

  bot.command("start", (ctx) => ctx.reply(ctx.t("start")));

  return bot;
}
