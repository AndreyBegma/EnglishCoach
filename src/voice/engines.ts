import { type AudioCredentials, audioUrl } from "./credentials";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Which English the learner hears. Picks the Kokoro voice; OpenAI has one voice for both. */
export type EnglishVariant = "us" | "uk";

export type EngineId = "kokoro" | "openai";

/** The speech request failed; carries no key and no response body. */
export class SpeechError extends Error {
  override name = "SpeechError";
}

/**
 * One way of turning text into an Ogg/Opus voice note. `userId` is the learner the audio is for;
 * undefined for background work (prewarm), where only server-side resources may be used.
 */
export interface SpeechEngine {
  readonly id: EngineId;
  voice(variant: EnglishVariant): string;
  available(userId?: number): Promise<boolean>;
  synthesize(text: string, voice: string, userId?: number): Promise<Buffer>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const OGG_MAGIC = Buffer.from("OggS");

/** An OpenAI-shaped `audio/speech` call. Telegram plays only Ogg/Opus as a voice note. */
async function requestSpeech(
  fetcher: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SpeechError("speech request failed");
  }
  if (!response.ok) throw new SpeechError(`speech request failed with status ${response.status}`);

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new SpeechError("speech response was empty");
  if (!audio.subarray(0, OGG_MAGIC.length).equals(OGG_MAGIC)) {
    throw new SpeechError("speech response is not Ogg/Opus");
  }
  return audio;
}

export const KOKORO_MODEL = "kokoro";
const HEALTH_TIMEOUT_MS = 2_000;
const HEALTH_TTL_MS = 30_000;

export interface KokoroOptions {
  url: string;
  voices: Record<EnglishVariant, string>;
  fetch: FetchLike;
  now?: () => number;
}

/**
 * Kokoro-82M behind Kokoro-FastAPI: local, free, no key. Its health is probed at most every
 * 30 s — the answer, good or bad, is reused so a down service costs one request, not one per tap.
 */
export class KokoroEngine implements SpeechEngine {
  readonly id = "kokoro";
  private readonly base: string;
  private health: { ok: boolean; at: number } | undefined;
  private probe: Promise<boolean> | undefined;

  constructor(private readonly options: KokoroOptions) {
    this.base = options.url.replace(/\/+$/, "");
  }

  voice(variant: EnglishVariant): string {
    return this.options.voices[variant];
  }

  async available(): Promise<boolean> {
    const now = (this.options.now ?? Date.now)();
    if (this.health && now - this.health.at < HEALTH_TTL_MS) return this.health.ok;
    this.probe ??= this.check().then((ok) => {
      this.health = { ok, at: (this.options.now ?? Date.now)() };
      this.probe = undefined;
      return ok;
    });
    return this.probe;
  }

  private async check(): Promise<boolean> {
    try {
      const response = await this.options.fetch(`${this.base}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async synthesize(text: string, voice: string): Promise<Buffer> {
    try {
      return await requestSpeech(
        this.options.fetch,
        `${this.base}/v1/audio/speech`,
        {},
        { model: KOKORO_MODEL, voice, input: text, response_format: "opus", stream: false },
      );
    } catch (error) {
      // Whatever went wrong, ask the health endpoint again before the next attempt.
      this.health = undefined;
      throw error;
    }
  }
}

export const OPENAI_TTS_MODEL = "tts-1";
export const OPENAI_TTS_VOICE = "alloy";

export interface OpenAiSpeechOptions {
  /** The learner's credentials, else the server key; undefined `userId` means server key only. */
  credentials: (userId?: number) => Promise<AudioCredentials | undefined>;
  fetch: FetchLike;
}

/** OpenAI-compatible TTS with the learner's own key or the server's. Costs money per call. */
export class OpenAiSpeechEngine implements SpeechEngine {
  readonly id = "openai";

  constructor(private readonly options: OpenAiSpeechOptions) {}

  voice(): string {
    return OPENAI_TTS_VOICE;
  }

  async available(userId?: number): Promise<boolean> {
    return (await this.options.credentials(userId)) !== undefined;
  }

  async synthesize(text: string, voice: string, userId?: number): Promise<Buffer> {
    const credentials = await this.options.credentials(userId);
    if (!credentials) throw new SpeechError("no audio credentials");
    return requestSpeech(
      this.options.fetch,
      audioUrl(credentials, "audio/speech"),
      { authorization: `Bearer ${credentials.apiKey}` },
      { model: OPENAI_TTS_MODEL, voice, input: text, response_format: "opus" },
    );
  }
}
