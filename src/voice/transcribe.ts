import { z } from "zod";
import { type AudioCredentials, audioUrl } from "./credentials";
import type { FetchLike } from "./tts";

export const STT_MODEL = "whisper-1";
const REQUEST_TIMEOUT_MS = 30_000;

/** A recognized word with its position in the audio, in seconds. */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  /** 0–1 confidence; only engines that report it (faster-whisper does, OpenAI does not). */
  probability?: number;
}

export interface Transcript {
  text: string;
  /** Empty when the engine returned no word timestamps. */
  words: TranscriptWord[];
}

/** Where one transcription request goes and how it is authorized. */
export interface SttTarget {
  /** `openai` is a paid key (the learner's or the server's); `whisper` is the local container. */
  id: "openai" | "whisper";
  /** Full URL of the `audio/transcriptions` endpoint. */
  url: string;
  headers: Record<string, string>;
  model: string;
}

const response = z.object({
  text: z.string(),
  words: z
    .array(
      z.object({
        word: z.string(),
        start: z.number(),
        end: z.number(),
        probability: z.number().optional(),
      }),
    )
    .optional(),
});

/** Transcription failed; carries no key and no response body. */
export class TranscriptionError extends Error {
  override name = "TranscriptionError";
}

/** The learner's or the server's OpenAI-compatible key. */
export function openAiTarget(credentials: AudioCredentials): SttTarget {
  return {
    id: "openai",
    url: audioUrl(credentials, "audio/transcriptions"),
    headers: { authorization: `Bearer ${credentials.apiKey}` },
    model: STT_MODEL,
  };
}

/** The local faster-whisper container (OpenAI-compatible, no key). */
export function whisperTarget(baseUrl: string, model: string): SttTarget {
  return {
    id: "whisper",
    url: `${baseUrl.replace(/\/+$/, "")}/v1/audio/transcriptions`,
    headers: {},
    model,
  };
}

/** Whisper-compatible `audio/transcriptions`. The learner speaks English, so the language is pinned. */
export async function transcribe(
  audio: Uint8Array,
  target: SttTarget,
  fetcher: FetchLike = (url, init) => globalThis.fetch(url, init),
): Promise<Transcript> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/ogg" }), "voice.ogg");
  form.append("model", target.model);
  form.append("language", "en");
  // verbose_json carries word timestamps (and confidence where the engine has it).
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  let reply: Response;
  try {
    reply = await fetcher(target.url, {
      method: "POST",
      headers: target.headers,
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TranscriptionError("transcription request failed");
  }
  if (!reply.ok) {
    throw new TranscriptionError(`transcription request failed with status ${reply.status}`);
  }
  const parsed = response.safeParse(await reply.json().catch(() => undefined));
  if (!parsed.success) throw new TranscriptionError("transcription response was malformed");
  return { text: parsed.data.text.trim(), words: parsed.data.words ?? [] };
}

/**
 * Tries each target in order — the learner's key, the server key, then local whisper — and returns
 * the first transcript. Throws the last error when every target fails.
 */
export async function transcribeWithFallback(
  audio: Uint8Array,
  targets: readonly SttTarget[],
  fetcher: FetchLike,
  onFailure?: (target: SttTarget, error: TranscriptionError) => void,
): Promise<Transcript> {
  let last: TranscriptionError = new TranscriptionError("no transcription engine");
  for (const target of targets) {
    try {
      return await transcribe(audio, target, fetcher);
    } catch (error) {
      if (!(error instanceof TranscriptionError)) throw error;
      onFailure?.(target, error);
      last = error;
    }
  }
  throw last;
}
