import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Api, InputFile } from "grammy";
import type { Message } from "grammy/types";
import type { TtsAudioKey } from "../db/repositories/voice";
import type { Logger } from "../log";
import { type EnglishVariant, type SpeechEngine, SpeechError } from "./engines";

export { type FetchLike, SpeechError } from "./engines";

/** Where uploaded voice notes are remembered (the `tts_audio` table in production). */
export interface FileIdStore {
  find(key: TtsAudioKey): Promise<string | undefined>;
  save(key: TtsAudioKey, fileId: string): Promise<void>;
}

/** What one `prewarm` call did: newly uploaded, found already stored, or could not store. */
export interface PrewarmResult {
  generated: number;
  stored: number;
  failed: number;
}

/** Telegram allows a bot about 20 messages a minute in one group; prewarm stays under that. */
export const PREWARM_INTERVAL_MS = 3_000;

export interface TtsOptions {
  /** Engines in order of preference; the first that works produces the audio. */
  engines: readonly SpeechEngine[];
  fileIds: FileIdStore;
  /** Private chat where each voice note is uploaded once; unset means upload on every send. */
  storageChatId?: number;
  /** Needed by `prewarm`, which runs outside any update. */
  api?: Api;
  log: Logger;
  /** Disk cache directory; read at call time from `TTS_CACHE_DIR`, default `data/tts`. */
  dir?: string;
  prewarmIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The same text in any casing or spacing is the same audio. */
export function normalizeSpeechText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function speechTextHash(text: string): string {
  return createHash("sha256").update(normalizeSpeechText(text)).digest("hex");
}

type Source = { kind: "file"; fileId: string } | { kind: "audio"; audio: Buffer; key: TtsAudioKey };

/**
 * Pronunciation voice notes. A text is synthesised once (the first engine that is up wins),
 * written to the disk cache, and — with a storage chat — uploaded there once; its `file_id` is
 * stored and every later play is `sendVoice(file_id)`: no synthesis, no upload, never a forward.
 * Concurrent requests for one text share a single synthesis and a single upload.
 */
export class Tts {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly prewarmed = new Set<string>();
  private prewarmQueue: Promise<void> = Promise.resolve();
  /** Storage-chat uploads so far; prewarm waits only after a text that cost one. */
  private uploads = 0;

  constructor(private readonly options: TtsOptions) {}

  /** Whether any engine can voice a new text for this learner right now. */
  async available(userId?: number): Promise<boolean> {
    for (const engine of this.options.engines) {
      if (await engine.available(userId)) return true;
    }
    return false;
  }

  /**
   * Sends `text` as a voice note to `chatId`. Throws `SpeechError` when nothing is cached and no
   * engine can produce it; the caller explains that to the learner.
   */
  async play(
    api: Api,
    chatId: number,
    text: string,
    variant: EnglishVariant,
    userId?: number,
  ): Promise<Message.VoiceMessage> {
    const source = await this.source(api, text, variant, userId);
    if (source.kind === "audio") return api.sendVoice(chatId, voiceFile(source.audio));
    try {
      return await api.sendVoice(chatId, source.fileId);
    } catch (error) {
      // A file_id dies with the bot token it was issued to; voice the text again.
      this.options.log.warn("stored voice note could not be sent", { error: message(error) });
      const fresh = await this.source(api, text, variant, userId, { skipFileIds: true });
      return api.sendVoice(chatId, fresh.kind === "file" ? fresh.fileId : voiceFile(fresh.audio));
    }
  }

  /**
   * Synthesises and uploads `texts` in the background so the learner's first tap is instant.
   * One upload per `PREWARM_INTERVAL_MS`; texts already stored cost a database read. A no-op
   * without a storage chat. Never rejects: failures are logged, counted, and the text is retried
   * on play or the next prewarm. Resolves when these texts are done, with what became of them.
   */
  prewarm(texts: readonly string[], variant: EnglishVariant): Promise<PrewarmResult> {
    const result: PrewarmResult = { generated: 0, stored: 0, failed: 0 };
    const { api, storageChatId } = this.options;
    if (!api || storageChatId === undefined) return Promise.resolve(result);
    const fresh = texts.filter((text) => {
      const id = `${variant}:${speechTextHash(text)}`;
      if (!normalizeSpeechText(text) || this.prewarmed.has(id)) return false;
      this.prewarmed.add(id);
      return true;
    });
    const interval = this.options.prewarmIntervalMs ?? PREWARM_INTERVAL_MS;
    const sleep = this.options.sleep ?? ((ms: number) => Bun.sleep(ms));
    const run = this.prewarmQueue.then(async () => {
      for (const text of fresh) {
        const id = `${variant}:${speechTextHash(text)}`;
        try {
          const uploads = this.uploads;
          const source = await this.source(api, text, variant);
          const uploaded = this.uploads > uploads;
          // An upload the storage chat refused leaves nothing stored: try again another time.
          if (source.kind === "audio") {
            this.prewarmed.delete(id);
            result.failed++;
          } else if (uploaded) result.generated++;
          else result.stored++;
          if (uploaded) await sleep(interval);
        } catch (error) {
          this.prewarmed.delete(id);
          result.failed++;
          this.options.log.warn("speech prewarm failed", { error: message(error) });
        }
      }
      return result;
    });
    this.prewarmQueue = run.then(() => undefined);
    return run;
  }

  /**
   * Whether 🔊 would work for this learner: the text is already voiced (a stored `file_id` or the
   * disk cache, for any engine) or an engine can voice it now.
   */
  async canPlay(text: string, variant: EnglishVariant, userId?: number): Promise<boolean> {
    if (!normalizeSpeechText(text)) return false;
    const textHash = speechTextHash(text);
    for (const engine of this.options.engines) {
      const voice = engine.voice(variant);
      if (await this.options.fileIds.find({ engine: engine.id, voice, textHash })) return true;
      if (await Bun.file(this.path(voice, textHash)).exists()) return true;
    }
    return this.available(userId);
  }

  /** The engine background work prefers, and its voice per variant; undefined with no engine. */
  primary(): { engine: string; voices: Record<EnglishVariant, string> } | undefined {
    const [engine] = this.options.engines;
    if (!engine) return undefined;
    return { engine: engine.id, voices: { us: engine.voice("us"), uk: engine.voice("uk") } };
  }

  /** Whether background prewarm can store anything (an API and a storage chat). */
  get canPrewarm(): boolean {
    return this.options.api !== undefined && this.options.storageChatId !== undefined;
  }

  private async source(
    api: Api,
    text: string,
    variant: EnglishVariant,
    userId?: number,
    opts: { skipFileIds?: boolean } = {},
  ): Promise<Source> {
    const textHash = speechTextHash(text);
    if (!opts.skipFileIds) {
      for (const engine of this.options.engines) {
        const key = { engine: engine.id, voice: engine.voice(variant), textHash };
        const fileId = await this.options.fileIds.find(key);
        if (fileId) return { kind: "file", fileId };
      }
    }
    const { audio, key } = await this.audio(text, variant, userId);
    const { storageChatId } = this.options;
    if (storageChatId === undefined) return { kind: "audio", audio, key };
    return this.once(`upload:${key.engine}:${key.voice}:${textHash}`, () =>
      this.upload(api, storageChatId, audio, key),
    );
  }

  private async upload(
    api: Api,
    storageChatId: number,
    audio: Buffer,
    key: TtsAudioKey,
  ): Promise<Source> {
    try {
      this.uploads++;
      const sent = await api.sendVoice(storageChatId, voiceFile(audio));
      await this.options.fileIds.save(key, sent.voice.file_id);
      return { kind: "file", fileId: sent.voice.file_id };
    } catch (error) {
      // The storage chat is an optimisation: without it the note is uploaded with each send.
      this.options.log.warn("voice note upload to the storage chat failed", {
        error: message(error),
      });
      return { kind: "audio", audio, key };
    }
  }

  /** Disk cache of any engine first, then the first engine that is up and answers. */
  private async audio(
    text: string,
    variant: EnglishVariant,
    userId?: number,
  ): Promise<{ audio: Buffer; key: TtsAudioKey }> {
    const textHash = speechTextHash(text);
    const { engines } = this.options;
    for (const engine of engines) {
      const voice = engine.voice(variant);
      const hit = await this.cached(voice, textHash);
      if (hit) return { audio: hit, key: { engine: engine.id, voice, textHash } };
    }
    for (const engine of engines) {
      if (!(await engine.available(userId))) continue;
      const voice = engine.voice(variant);
      const key = { engine: engine.id, voice, textHash };
      try {
        const audio = await this.once(`synth:${engine.id}:${voice}:${textHash}`, () =>
          this.generate(engine, text, key, userId),
        );
        return { audio, key };
      } catch (error) {
        if (!(error instanceof SpeechError)) throw error;
        this.options.log.warn("speech engine failed", { engine: engine.id, error: error.message });
      }
    }
    throw new SpeechError("no speech engine available");
  }

  private async generate(engine: SpeechEngine, text: string, key: TtsAudioKey, userId?: number) {
    const audio = await engine.synthesize(text.trim(), key.voice, userId);
    // Write beside the target, then rename, so a reader never sees half a file.
    const path = this.path(key.voice, key.textHash);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, audio);
    await rename(temporary, path);
    return audio;
  }

  private path(voice: string, textHash: string): string {
    const dir = this.options.dir ?? (process.env.TTS_CACHE_DIR?.trim() || "data/tts");
    return join(dir, voice, `${textHash}.ogg`);
  }

  private async cached(voice: string, textHash: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.path(voice, textHash));
    } catch {
      return undefined;
    }
  }

  private once<T>(id: string, work: () => Promise<T>): Promise<T> {
    let pending = this.inflight.get(id) as Promise<T> | undefined;
    if (!pending) {
      pending = work().finally(() => this.inflight.delete(id));
      this.inflight.set(id, pending);
    }
    return pending;
  }
}

function voiceFile(audio: Buffer): InputFile {
  return new InputFile(audio, "voice.ogg");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
