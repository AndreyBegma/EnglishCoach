import { type Api, Composer } from "grammy";
import type { BotContext } from "../bot/context";
import type { Translator } from "../bot/i18n";
import { parseSttEnv, parseTtsEnv, type SttEnv, type TtsEnv } from "../config/env";
import type { Db } from "../db/client";
import { getCard } from "../db/repositories/cards";
import type { SessionKind } from "../db/repositories/sessions";
import {
  findTtsFileId,
  getStatusBoard,
  saveStatusBoard,
  saveTtsFileId,
} from "../db/repositories/voice";
import type { ServerEnv } from "../llm/providers/server";
import type { Logger } from "../log";
import type { SessionManager } from "../sessions/session-manager";
import { escapeHtml, HTML } from "../vocab/render";
import { firstExample } from "../vocab/speak";
import { readFlow } from "../vocab/state";
import { VoiceBackfill } from "./backfill";
import { isVoiceCallbackData, parseVoiceCallback } from "./callbacks";
import { type CredentialDeps, resolveAudioCredentials } from "./credentials";
import {
  type FetchLike,
  KokoroEngine,
  OpenAiSpeechEngine,
  type SpeechEngine,
  SpeechError,
} from "./engines";
import { StatusBoard } from "./status-board";
import { openAiTarget, type SttTarget, transcribeWithFallback, whisperTarget } from "./transcribe";
import { Tts, type TtsOptions } from "./tts";

export { encodeVoiceCallback } from "./callbacks";
export type { EnglishVariant } from "./engines";
export type { Tts } from "./tts";

/** Longest voice message that is transcribed. */
export const MAX_VOICE_SECONDS = 60;
/** Whisper takes 25 MB; a minute of Telegram's Opus is a small fraction of that. */
const MAX_VOICE_BYTES = 5 * 1024 * 1024;

const TELEGRAM_FILE_ROOT = "https://api.telegram.org/file";

/** Sessions whose typed answers a voice message can stand in for. */
const STT_KINDS: ReadonlySet<SessionKind> = new Set(["talk", "grammar", "review", "placement"]);

export interface VoiceOptions extends Pick<TtsOptions, "dir" | "prewarmIntervalMs" | "sleep"> {
  /** Tests replace the HTTP client for Telegram file downloads and the audio endpoints. */
  fetch?: FetchLike;
  /** TTS settings; default: `TTS_*` from the environment. */
  tts?: TtsEnv;
  /** STT settings; default: `STT_*` from the environment. */
  stt?: SttEnv;
  /** The voice backfill's and status board's clock (ms); tests pin it. */
  now?: () => number;
}

export interface VoiceDeps {
  db: Db;
  /** The bot's API, for background prewarm uploads; without it `prewarm` does nothing. */
  api?: Api;
  i18n: Translator;
  sessions: SessionManager;
  llmEnv: ServerEnv;
  masterKey: Buffer;
  log: Logger;
  /** `ADMIN_TELEGRAM_IDS`, for the backfill's learners and the status board's language. */
  adminTelegramIds?: readonly number[];
  options?: VoiceOptions;
}

/**
 * Voice for the learning sessions. `stt` turns a voice message into a text update before the
 * session handlers run, so talk, grammar and review stay unchanged; `tts` answers the 🔊 button of
 * a vocabulary card with a pronunciation voice note in the learner's `english_variant` — local
 * Kokoro first, then an OpenAI-compatible key. Both respect `user_settings.voice_enabled` and degrade to a localized
 * explanation when nothing can do the job. `tts.available(userId)` tells card renderers whether
 * to show 🔊 at all; `tts.prewarm(texts, variant)` voices upcoming words ahead of time.
 */
export function createVoice(deps: VoiceDeps) {
  const { db, i18n, sessions, log } = deps;
  const credentialDeps: CredentialDeps = { db, env: deps.llmEnv, masterKey: deps.masterKey };
  const fetcher: FetchLike = deps.options?.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const ttsEnv = deps.options?.tts ?? parseTtsEnv();
  const sttEnv = deps.options?.stt ?? parseSttEnv();

  const engines: SpeechEngine[] = [];
  if (ttsEnv.TTS_URL) {
    engines.push(
      new KokoroEngine({
        url: ttsEnv.TTS_URL,
        voices: { us: ttsEnv.TTS_VOICE_US, uk: ttsEnv.TTS_VOICE_UK },
        fetch: fetcher,
      }),
    );
  }
  engines.push(
    new OpenAiSpeechEngine({
      // Background work (prewarm) has no learner and is speculative: it never spends a paid key.
      credentials: async (userId) =>
        userId === undefined ? undefined : resolveAudioCredentials(credentialDeps, userId),
      fetch: fetcher,
    }),
  );
  const tts = new Tts({
    engines,
    fileIds: {
      find: (key) => findTtsFileId(db, key),
      save: (key, fileId) => saveTtsFileId(db, key, fileId),
    },
    storageChatId: ttsEnv.TTS_STORAGE_CHAT_ID,
    api: deps.api,
    log,
    dir: deps.options?.dir,
    prewarmIntervalMs: deps.options?.prewarmIntervalMs,
    sleep: deps.options?.sleep,
  });

  const stt = new Composer<BotContext>();
  stt.on("message:voice", async (ctx, next) => {
    if (!ctx.settings.voiceEnabled || !ctx.chat) return next();
    const active = await sessions.findActive(ctx.user.id);
    if (!active || !STT_KINDS.has(active.kind)) return next();
    // Review only takes typed answers at one of its steps; elsewhere a voice message means nothing.
    if (active.kind === "review" && readFlow(ctx, active.id)?.kind !== "typed") return next();

    const handle = sessions.handle(active, ctx.user, ctx.settings.uiLang);
    const t = (key: string, vars?: Record<string, string | number>) =>
      i18n.t(handle.locale, key, vars);
    // The voice message is the learner's message: track it, and tell them why nothing happened.
    const refuse = async (key: string, vars?: Record<string, string | number>) => {
      if (ctx.chat) await sessions.recordIncoming(active, ctx.chat.id, ctx.message.message_id);
      await handle.window.flashNote(t(key, vars));
    };

    const { voice } = ctx.message;
    if (voice.duration > MAX_VOICE_SECONDS) {
      return refuse("voice-too-long", { seconds: MAX_VOICE_SECONDS });
    }
    if ((voice.file_size ?? 0) > MAX_VOICE_BYTES) {
      return refuse("voice-too-long", { seconds: MAX_VOICE_SECONDS });
    }
    const credentials = await resolveAudioCredentials(credentialDeps, ctx.user.id);
    // The learner's key, else the server key, else local whisper.
    const targets: SttTarget[] = [];
    if (credentials) targets.push(openAiTarget(credentials));
    if (sttEnv.STT_URL) targets.push(whisperTarget(sttEnv.STT_URL, sttEnv.STT_MODEL));
    if (targets.length === 0) return refuse("voice-needs-key");

    let transcript: string;
    try {
      const file = await ctx.getFile();
      if (!file.file_path) throw new Error("telegram returned no file path");
      const { api } = ctx;
      const download = await fetcher(`${TELEGRAM_FILE_ROOT}/bot${api.token}/${file.file_path}`);
      if (!download.ok) throw new Error(`file download failed with status ${download.status}`);
      // The result also carries word timestamps, for the pronunciation feedback that comes later.
      ({ text: transcript } = await transcribeWithFallback(
        new Uint8Array(await download.arrayBuffer()),
        targets,
        fetcher,
        (target, failure) =>
          log.warn("voice transcription engine failed", {
            userId: ctx.user.id,
            engine: target.id,
            error: failure.message,
          }),
      ));
    } catch (error) {
      log.warn("voice transcription failed", {
        userId: ctx.user.id,
        sessionId: active.id,
        error: error instanceof Error ? error.message : "unknown error",
      });
      return refuse("voice-stt-failed");
    }
    if (!transcript) return refuse("voice-empty");

    // What was heard, for a few seconds: the session's window carries the answer itself.
    await handle.window.flashNote(t("voice-transcript", { text: escapeHtml(transcript) }), HTML);
    // From here on it is a typed message, as far as every later handler can tell.
    (ctx.message as { text?: string }).text = transcript;
    return next();
  });

  const speak = new Composer<BotContext>();
  speak.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!isVoiceCallbackData(data)) return next();

    const alert = (key: string) => ctx.answerCallbackQuery({ text: ctx.t(key), show_alert: true });
    const callback = parseVoiceCallback(data);
    const handle = ctx.learning;
    const chatId = ctx.chat?.id;
    if (!callback || !handle || chatId === undefined) return alert("voice-outdated");
    if (!ctx.settings.voiceEnabled) return alert("voice-disabled");

    const card = await getCard(db, ctx.user.id, callback.cardId);
    if (!card || card.itemType === "grammar_pattern") return alert("voice-outdated");
    const text = callback.target === "example" ? firstExample(card) : card.front;
    if (!text) return alert("voice-outdated");

    // Not `acceptAnswer`: 🔊 leaves the card on screen, so it keeps its keyboard and text. It
    // takes the same lock, so it never races an answer that is moving the session on.
    let stale = false;
    const ran = await handle.withLock(async () => {
      // 🔊 is on a new word's card and on review feedback, nowhere else.
      const step = readFlow(ctx, handle.session.id);
      if ((step?.kind !== "card" && step?.kind !== "rate") || step.cardId !== card.id) {
        stale = true;
        return;
      }
      void ctx.api.sendChatAction(chatId, "record_voice").catch(() => {});
      let message: Awaited<ReturnType<Tts["play"]>>;
      try {
        message = await tts.play(ctx.api, chatId, text, ctx.settings.englishVariant, ctx.user.id);
      } catch (error) {
        if (!(error instanceof SpeechError)) throw error;
        log.warn("speech generation failed", {
          userId: ctx.user.id,
          cardId: card.id,
          error: error.message,
        });
        await alert((await tts.available(ctx.user.id)) ? "voice-tts-failed" : "voice-needs-key");
        return;
      }
      await ctx.answerCallbackQuery();
      await handle.track(message.message_id);
    });
    if (stale) await ctx.answerCallbackQuery({ text: ctx.t("answer-stale") });
    else if (!ran) await ctx.answerCallbackQuery({ text: ctx.t("answer-busy") });
  });

  const storageChatId = ttsEnv.TTS_STORAGE_CHAT_ID;
  const board =
    storageChatId !== undefined && deps.api
      ? new StatusBoard({
          api: deps.api,
          chatId: storageChatId,
          store: {
            messageId: async () =>
              (await getStatusBoard(db, storageChatId))?.messageId ?? undefined,
            setMessageId: (messageId) =>
              saveStatusBoard(db, storageChatId, { messageId: messageId ?? null }),
          },
          log,
          now: deps.options?.now,
        })
      : undefined;
  const backfill = new VoiceBackfill({
    db,
    tts,
    i18n,
    log,
    board,
    adminTelegramIds: deps.adminTelegramIds,
    now: deps.options?.now && (() => new Date(deps.options?.now?.() ?? Date.now())),
  });
  const storageChatIds = storageChatId === undefined ? [] : [storageChatId];
  return { stt, speak, tts, backfill, storageChatIds };
}
