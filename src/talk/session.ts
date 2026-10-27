import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../bot/context";
import type { Locale, Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { upsertMistake } from "../db/repositories/mistakes";
import { getSettings } from "../db/repositories/users";
import { grammarBand } from "../grammar/progress";
import { topicChoices } from "../grammar/topics";
import { recordTalkTurn } from "../levels";
import type { Logger } from "../log";
import { acceptAnswer } from "../sessions/answer";
import type { LearningHandle, SessionKindHandler } from "../sessions/session-manager";
import type { SkillRunner } from "../skills";
import { encodeTalkCallback, parseTalkCallback } from "./callbacks";
import { conversationPattern } from "./mistakes";
import { renderTurn, summarise } from "./render";
import { capHistory, newTalkState, type TalkState, TIP_EVERY } from "./state";
import { suggestTopics } from "./topics";

export interface TalkDeps {
  db: Db;
  skills: SkillRunner;
  i18n: Translator;
  log: Logger;
}

/** Server-owned first learner turn: it makes the model open the conversation with a question. */
const STARTER = "Hi! Let's start our English chat.";

const TIP_KINDS = ["phrase", "grammar", "level_up", "native_pitfall"] as const;

const finishKeyboard = (sessionId: number, label: string) =>
  new InlineKeyboard().text(label, encodeTalkCallback({ type: "finish", sessionId }));

function talkState(ctx: BotContext, sessionId: number): TalkState | undefined {
  const state = ctx.session.talk;
  return state?.sessionId === sessionId ? state : undefined;
}

/** One learner message through the `conversation` skill; the reply goes out as a session message. */
async function takeTurn(
  deps: TalkDeps,
  session: LearningHandle,
  ctx: BotContext,
  state: TalkState,
  text: string,
) {
  const { db, skills, i18n, log } = deps;
  const learnerMessage = ctx.message?.message_id;
  const { id: userId } = session.user;
  const tipKind = TIP_KINDS[state.messages % TIP_KINDS.length] ?? "phrase";

  let turn: Awaited<ReturnType<typeof skills.runSkill<"conversation">>>["data"];
  try {
    ({ data: turn } = await skills.runSkill(
      userId,
      "conversation",
      {
        topic: state.topic,
        learner_message: text,
        tip_kind: tipKind,
        syllabus_topics: topicChoices(await grammarBand(db, userId)),
      },
      state.history,
    ));
  } catch (error) {
    // Nothing was stored, so the learner can simply send the message again.
    log.warn("talk turn failed", { sessionId: session.session.id, error });
    if (learnerMessage !== undefined) state.exchange = [...(state.exchange ?? []), learnerMessage];
    await session.window.flashNote(i18n.t(session.locale, "talk-error"));
    return;
  }

  state.history = capHistory([
    ...state.history,
    { role: "user", content: text },
    { role: "assistant", content: turn.reply },
  ]);
  state.messages += 1;
  state.corrections += turn.corrections.length;
  for (const c of turn.corrections) {
    state.categories[c.category] = (state.categories[c.category] ?? 0) + 1;
  }

  const reply = await session.send(
    renderTurn(i18n, session.locale, turn, state.messages % TIP_EVERY === 0),
    {
      parse_mode: "HTML",
      reply_markup: finishKeyboard(session.session.id, i18n.t(session.locale, "talk-finish")),
    },
  );
  // The chat keeps the latest exchange only; older ones (and failed attempts) go.
  await session.window.discard(state.exchange ?? []);
  state.exchange =
    learnerMessage === undefined ? [reply.message_id] : [learnerMessage, reply.message_id];

  // The learner already has their answer; a failed write must not take the conversation down.
  for (const c of turn.corrections) {
    await upsertMistake(db, userId, {
      category: c.category,
      pattern: conversationPattern(c.original, c.corrected),
      exampleWrong: c.original,
      exampleRight: c.corrected,
      explanation: c.why,
    }).catch((error: unknown) => {
      log.warn("talk mistake upsert failed", { sessionId: session.session.id, error });
    });
  }
  await recordTalkTurn(db, userId, text, turn.corrections, turn.topic_uses).catch(
    (error: unknown) => {
      log.warn("talk level update failed", { sessionId: session.session.id, error });
    },
  );
}

/** The bot's opening question, from the model or, if that fails, a fixed one. */
async function open(deps: TalkDeps, session: LearningHandle, state: TalkState) {
  const { skills, i18n, log } = deps;
  let text: string;
  try {
    const { data } = await skills.runSkill(session.user.id, "conversation", {
      topic: state.topic,
      learner_message: STARTER,
      tip_kind: "phrase",
    });
    state.history = [
      { role: "user", content: STARTER },
      { role: "assistant", content: data.reply },
    ];
    text = data.reply;
  } catch (error) {
    log.warn("talk opener failed", { sessionId: session.session.id, error });
    text = i18n.t(session.locale, "talk-opener-fallback");
  }
  const opener = await session.send(text, {
    reply_markup: finishKeyboard(session.session.id, i18n.t(session.locale, "talk-finish")),
  });
  state.exchange = [opener.message_id];
}

function topicKeyboard(
  deps: TalkDeps,
  sessionId: number,
  locale: Locale,
  topics: ReturnType<typeof suggestTopics>,
) {
  const keyboard = new InlineKeyboard();
  topics.forEach((topic, index) => {
    const label =
      topic.kind === "stock" ? deps.i18n.t(locale, `talk-topic-${topic.id}`) : topic.text;
    keyboard.text(label, encodeTalkCallback({ type: "pick", sessionId, topic: index }));
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard
    .row()
    .text(
      deps.i18n.t(locale, "talk-topic-free"),
      encodeTalkCallback({ type: "pick", sessionId, topic: "free" }),
    );
}

export function talkSession(deps: TalkDeps): SessionKindHandler {
  return {
    // A chat: the latest exchange stays on screen, `takeTurn` prunes the older ones.
    keepsLearnerMessages: true,
    async onStart(session) {
      const settings = await getSettings(deps.db, session.user.id);
      const topics = suggestTopics({
        cefrLevel: settings?.cefrLevel ?? null,
        interests: settings?.interests ?? [],
      });
      await session.send(deps.i18n.t(session.locale, "talk-pick-topic"), {
        reply_markup: topicKeyboard(deps, session.session.id, session.locale, topics),
      });
    },

    async onMessage(session, ctx) {
      const text = ctx.message?.text?.trim();
      if (!text) {
        await session.window.flashNote(deps.i18n.t(session.locale, "talk-text-only"));
        if (ctx.message) await session.window.consumeUserMessage(ctx.message.message_id);
        return;
      }
      // Typing before picking a topic is a free conversation: the learner went first.
      let state = talkState(ctx, session.session.id);
      if (!state) {
        state = newTalkState(session.session.id, null, true);
        ctx.session.talk = state;
      }
      state.started = true;
      await takeTurn(deps, session, ctx, state, text);
    },
  };
}

/** The topic and Finish buttons. Mounted after the learning-session middleware. */
export function talkHandlers(deps: TalkDeps): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.on("callback_query:data", async (ctx, next) => {
    const callback = parseTalkCallback(ctx.callbackQuery.data);
    if (!callback) return next();

    const session = ctx.learning;
    if (session?.session.kind !== "talk" || session.session.id !== callback.sessionId) {
      await ctx.answerCallbackQuery({ text: ctx.t("hub-outdated") });
      await ctx.deleteMessage().catch(() => {});
      return;
    }
    if (callback.type === "finish") {
      await ctx.answerCallbackQuery();
      await session.end(
        "finished",
        summarise(deps.i18n, session.locale, talkState(ctx, callback.sessionId)),
      );
      return;
    }

    const topics = suggestTopics(ctx.settings);
    const topic = callback.topic === "free" ? undefined : topics[callback.topic];
    // The picker shows the choice and no buttons until the opener is there, then goes. Once the
    // chat is going (a topic was picked, or the learner wrote first) the picker is stale.
    await acceptAnswer(
      ctx,
      { lock: session.withLock, current: () => !talkState(ctx, callback.sessionId)?.started },
      async () => {
        const state = newTalkState(callback.sessionId, topic?.text ?? null, true);
        ctx.session.talk = state;
        await open(deps, session, state);
        await ctx.deleteMessage().catch(() => {});
      },
    );
  });

  return composer;
}
