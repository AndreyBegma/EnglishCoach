import { Composer, InputFile } from "grammy";
import type { BotContext } from "../bot/context";
import type { Translator } from "../bot/i18n";
import type { Db } from "../db/client";
import { getCard } from "../db/repositories/cards";
import type { SessionKind } from "../db/repositories/sessions";
import type { ServerEnv } from "../llm/providers/server";
import type { Logger } from "../log";
import type { SessionManager } from "../sessions/session-manager";
import { escapeHtml, HTML } from "../vocab/render";
import { readFlow } from "../vocab/state";
import { isVoiceCallbackData, parseVoiceCallback } from "./callbacks";
import { type CredentialDeps, resolveAudioCredentials } from "./credentials";
import { transcribe } from "./transcribe";
import { type FetchLike, SpeechError, Tts, type TtsOptions } from "./tts";

export { encodeVoiceCallback } from "./callbacks";

/** Longest voice message that is transcribed. */
export const MAX_VOICE_SECONDS = 60;
/** Whisper takes 25 MB; a minute of Telegram's Opus is a small fraction of that. */
const MAX_VOICE_BYTES = 5 * 1024 * 1024;

const TELEGRAM_FILE_ROOT = "https://api.telegram.org/file";

/** Sessions whose typed answers a voice message can stand in for. */
const STT_KINDS: ReadonlySet<SessionKind> = new Set(["talk", "grammar", "review"]);

export interface VoiceOptions extends Pick<TtsOptions, "dir"> {
  /** Tests replace the HTTP client for Telegram file downloads and the audio endpoints. */
  fetch?: FetchLike;
}

export interface VoiceDeps {
  db: Db;
  i18n: Translator;
  sessions: SessionManager;
  llmEnv: ServerEnv;
  masterKey: Buffer;
  log: Logger;
  options?: VoiceOptions;
}

/**
 * Voice for the learning sessions. `stt` turns a voice message into a text update before the
 * session handlers run, so talk, grammar and review stay unchanged; `tts` answers the 🔊 button of
 * a vocabulary card with a pronunciation voice note. Both respect `user_settings.voice_enabled`
 * and degrade to a localized explanation when no OpenAI-compatible key is available.
 */
export function createVoice(deps: VoiceDeps) {
  const { db, i18n, sessions, log } = deps;
  const credentialDeps: CredentialDeps = { db, env: deps.llmEnv, masterKey: deps.masterKey };
  const fetcher: FetchLike = deps.options?.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const tts = new Tts({ dir: deps.options?.dir, fetch: fetcher });

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
      await handle.send(t(key, vars));
    };

    const { voice } = ctx.message;
    if (voice.duration > MAX_VOICE_SECONDS) {
      return refuse("voice-too-long", { seconds: MAX_VOICE_SECONDS });
    }
    if ((voice.file_size ?? 0) > MAX_VOICE_BYTES) {
      return refuse("voice-too-long", { seconds: MAX_VOICE_SECONDS });
    }
    const credentials = await resolveAudioCredentials(credentialDeps, ctx.user.id);
    if (!credentials) return refuse("voice-needs-key");

    let transcript: string;
    try {
      const file = await ctx.getFile();
      if (!file.file_path) throw new Error("telegram returned no file path");
      const { api } = ctx;
      const download = await fetcher(`${TELEGRAM_FILE_ROOT}/bot${api.token}/${file.file_path}`);
      if (!download.ok) throw new Error(`file download failed with status ${download.status}`);
      transcript = await transcribe(
        new Uint8Array(await download.arrayBuffer()),
        credentials,
        fetcher,
      );
    } catch (error) {
      log.warn("voice transcription failed", {
        userId: ctx.user.id,
        sessionId: active.id,
        error: error instanceof Error ? error.message : "unknown error",
      });
      return refuse("voice-stt-failed");
    }
    if (!transcript) return refuse("voice-empty");

    await handle.send(t("voice-transcript", { text: escapeHtml(transcript) }), HTML);
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

    let audio = await tts.cached(card.front);
    if (!audio) {
      const credentials = await resolveAudioCredentials(credentialDeps, ctx.user.id);
      if (!credentials) return alert("voice-needs-key");
      try {
        audio = await tts.speak(card.front, credentials);
      } catch (error) {
        if (!(error instanceof SpeechError)) throw error;
        log.warn("speech generation failed", {
          userId: ctx.user.id,
          cardId: card.id,
          error: error.message,
        });
        return alert("voice-tts-failed");
      }
    }
    await ctx.answerCallbackQuery();
    const message = await ctx.api.sendVoice(chatId, new InputFile(audio, "word.ogg"));
    await handle.track(message.message_id);
  });

  return { stt, speak, tts };
}
