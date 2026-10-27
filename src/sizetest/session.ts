import { Composer } from "grammy";
import type { BotContext } from "../bot/context";
import type { Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { insertSizeTest, listSizeTests } from "../db/repositories/sizetest";
import { getSettings } from "../db/repositories/users";
import type { Logger } from "../log";
import { acceptAnswer } from "../sessions/answer";
import { offerToCancel } from "../sessions/handlers";
import type {
  LearningHandle,
  SessionKindHandler,
  SessionManager,
} from "../sessions/session-manager";
import { coverageAt } from "../words/coverage";
import { parseSizeTestCallback } from "./callbacks";
import { estimateSize } from "./estimate";
import { type Pick, prepareItems, randomPick, tally } from "./items";
import { itemScreen, sizeLine, trendOf } from "./screens";
import type { SizeTestState } from "./state";

export interface SizeTestDeps {
  db: Db;
  i18n: Translator;
  log: Logger;
  /** Item sampling and shuffling; tests pin it. */
  pick?: Pick;
  now?: () => Date;
}

const BP = 10_000;

function ownState(ctx: BotContext, handle: LearningHandle): SizeTestState | undefined {
  const state = ctx.session.sizeTest;
  return state?.sessionId === handle.session.id ? state : undefined;
}

/** The `size_test` session kind: the items one by one, then the estimate into the history. */
export function sizeTestSession(deps: SizeTestDeps): SessionKindHandler {
  return {
    async onStart(handle, ctx) {
      const t = (key: string) => deps.i18n.t(handle.locale, key);
      // Started only from a button: the test lives in that update's flow state.
      if (!ctx) {
        await handle.end("cancelled");
        return;
      }
      const settings = await getSettings(deps.db, handle.user.id);
      const items = await prepareItems(
        deps.db,
        settings?.explainLang ?? "en",
        deps.pick ?? randomPick,
      );
      if (items.length === 0) {
        deps.log.info("size test: not enough words with meanings", { userId: handle.user.id });
        await handle.end("finished", { line: t("sizetest-unavailable") });
        return;
      }
      const state: SizeTestState = {
        sessionId: handle.session.id,
        items,
        answers: [],
        startedAt: (deps.now?.() ?? new Date()).toISOString(),
      };
      ctx.session.sizeTest = state;
      await showItem(deps, handle, state, t("sizetest-intro"));
    },

    async onMessage(handle) {
      await handle.window.flashNote(deps.i18n.t(handle.locale, "sizetest-use-buttons"));
    },
  };
}

async function showItem(
  deps: SizeTestDeps,
  handle: LearningHandle,
  state: SizeTestState,
  header?: string,
): Promise<void> {
  const index = state.answers.length;
  const item = state.items[index];
  if (!item) return;
  await handle.window.show(
    itemScreen(deps.i18n, handle.locale, item, index, state.items.length, header),
  );
}

/** Grades the run, stores it in the history and ends the session with the size as its summary. */
async function finish(deps: SizeTestDeps, handle: LearningHandle, state: SizeTestState) {
  const estimate = estimateSize(tally(state.items, state.answers));
  const coverage = coverageAt(estimate.words);
  const [previous] = await listSizeTests(deps.db, handle.user.id, 1);
  await insertSizeTest(deps.db, {
    userId: handle.user.id,
    sessionId: handle.session.id,
    items: state.items,
    answers: state.answers,
    startedAt: new Date(state.startedAt),
    finishedAt: deps.now?.() ?? new Date(),
    estimate: estimate.words,
    coverageBp: Math.round(coverage * BP),
    bands: estimate.known.map(({ band, share }) => ({ band, share: Math.round(share * BP) / BP })),
    falseAlarmsBp: Math.round(estimate.falseAlarms * BP),
  });
  const percent = Math.round(coverage * 100);
  const trend = trendOf(estimate.words, previous?.estimate ?? null);
  const line = sizeLine(deps.i18n, handle.locale, estimate.words, percent);
  await handle.end("finished", {
    line: trend ? `${line} (${trend})` : line,
    words: estimate.words,
    coverage: percent,
  });
}

export interface SizeTestHandlerDeps extends SizeTestDeps {
  sessions: SessionManager;
}

/** The offer button (hub, Progress) and the test's answer and stop buttons. */
export function sizeTestHandlers(deps: SizeTestHandlerDeps): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.on("callback_query:data", async (ctx, next) => {
    const callback = parseSizeTestCallback(ctx.callbackQuery.data);
    if (!callback) return next();

    if (callback.type === "start") {
      await ctx.answerCallbackQuery();
      const outcome = await deps.sessions.start(ctx.user, "size_test", ctx);
      if (!outcome.started) await offerToCancel(deps.sessions, ctx, outcome.active, ctx.user);
      return;
    }

    const handle = ctx.learning;
    if (handle?.session.kind !== "size_test") {
      await ctx.answerCallbackQuery({ text: ctx.t("sizetest-outdated") });
      await ctx.deleteMessage().catch(() => {});
      return;
    }

    if (callback.type === "stop") {
      await ctx.answerCallbackQuery();
      ctx.session.sizeTest = undefined;
      await handle.end("cancelled");
      return;
    }

    const onScreen = () => {
      const state = ownState(ctx, handle);
      return state?.answers.length === callback.item ? state : undefined;
    };
    const item = onScreen()?.items[callback.item];
    const chosen =
      callback.option === null ? ctx.t("sizetest-unknown") : (item?.options[callback.option] ?? "");
    await acceptAnswer(
      ctx,
      { lock: handle.withLock, chosen, current: () => onScreen() !== undefined },
      async () => {
        const state = onScreen();
        const asked = state?.items[callback.item];
        if (!state || !asked) return;
        const valid = callback.option === null || callback.option < asked.options.length;
        state.answers.push(valid ? callback.option : null);
        if (state.answers.length < state.items.length) {
          await showItem(deps, handle, state);
          return;
        }
        ctx.session.sizeTest = undefined;
        await finish(deps, handle, state);
      },
    );
  });

  return composer;
}
