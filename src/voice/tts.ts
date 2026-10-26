import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AudioCredentials, audioUrl } from "./credentials";

export const TTS_MODEL = "tts-1";
export const TTS_VOICE = "alloy";
const REQUEST_TIMEOUT_MS = 30_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The speech request failed; carries no key and no response body. */
export class SpeechError extends Error {
  override name = "SpeechError";
}

export interface TtsOptions {
  /** Cache directory; read at call time from `TTS_CACHE_DIR`, default `data/tts`. */
  dir?: string;
  fetch?: FetchLike;
  voice?: string;
  model?: string;
}

/**
 * Pronunciation audio (Telegram voice notes are Ogg/Opus). Generated audio is cached on disk, one
 * file per lemma and voice: it is derived data that can always be regenerated, and a file read
 * beats a database round trip. Concurrent requests for one lemma share a single API call.
 */
export class Tts {
  private readonly inflight = new Map<string, Promise<Buffer>>();

  constructor(private readonly options: TtsOptions = {}) {}

  private get voice() {
    return this.options.voice ?? TTS_VOICE;
  }

  private path(lemma: string): string {
    const dir = this.options.dir ?? (process.env.TTS_CACHE_DIR?.trim() || "data/tts");
    const digest = createHash("sha256").update(lemma.trim().toLowerCase()).digest("hex");
    return join(dir, this.voice, `${digest}.ogg`);
  }

  /** The cached audio for `lemma`, if it was generated before. */
  async cached(lemma: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.path(lemma));
    } catch {
      return undefined;
    }
  }

  /** The audio for `lemma`: from the cache, else generated with `credentials` and cached. */
  async speak(lemma: string, credentials: AudioCredentials | undefined): Promise<Buffer> {
    const hit = await this.cached(lemma);
    if (hit) return hit;
    if (!credentials) throw new SpeechError("no audio credentials");

    const path = this.path(lemma);
    let pending = this.inflight.get(path);
    if (!pending) {
      pending = this.generate(lemma, credentials, path).finally(() => this.inflight.delete(path));
      this.inflight.set(path, pending);
    }
    return pending;
  }

  private async generate(lemma: string, credentials: AudioCredentials, path: string) {
    const fetcher = this.options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    let response: Response;
    try {
      response = await fetcher(audioUrl(credentials, "audio/speech"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model ?? TTS_MODEL,
          voice: this.voice,
          input: lemma,
          response_format: "opus",
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new SpeechError("speech request failed");
    }
    if (!response.ok) throw new SpeechError(`speech request failed with status ${response.status}`);

    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) throw new SpeechError("speech response was empty");

    // Write beside the target, then rename, so a reader never sees half a file.
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, audio);
    await rename(temporary, path);
    return audio;
  }
}
