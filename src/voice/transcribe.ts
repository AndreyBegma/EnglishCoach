import { z } from "zod";
import { type AudioCredentials, audioUrl } from "./credentials";
import type { FetchLike } from "./tts";

export const STT_MODEL = "whisper-1";
const REQUEST_TIMEOUT_MS = 30_000;

const response = z.object({ text: z.string() });

/** Transcription failed; carries no key and no response body. */
export class TranscriptionError extends Error {
  override name = "TranscriptionError";
}

/** Whisper-compatible `audio/transcriptions`. The learner speaks English, so the language is pinned. */
export async function transcribe(
  audio: Uint8Array,
  credentials: AudioCredentials,
  fetcher: FetchLike = (url, init) => globalThis.fetch(url, init),
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/ogg" }), "voice.ogg");
  form.append("model", STT_MODEL);
  form.append("language", "en");
  form.append("response_format", "json");

  let reply: Response;
  try {
    reply = await fetcher(audioUrl(credentials, "audio/transcriptions"), {
      method: "POST",
      headers: { authorization: `Bearer ${credentials.apiKey}` },
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
  return parsed.data.text.trim();
}
