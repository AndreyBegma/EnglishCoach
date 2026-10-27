import { describe, expect, test } from "bun:test";
import { parseSttEnv } from "../../src/config/env";
import type { FetchLike } from "../../src/voice/engines";
import {
  openAiTarget,
  STT_MODEL,
  TranscriptionError,
  transcribe,
  transcribeWithFallback,
  whisperTarget,
} from "../../src/voice/transcribe";

const AUDIO = new Uint8Array([79, 103, 103, 83, 1, 2, 3]);
const OPENAI = "https://openai.test/v1";
const WHISPER = "http://stt.test:8000";
const WORDS = [
  { word: "I", start: 0, end: 0.2, probability: 0.98 },
  { word: "decided", start: 0.2, end: 0.7, probability: 0.91 },
];

type Call = { url: string; auth: string | null; form: FormData };

/** Both transcription services; each answers with `status` or with its own JSON. */
function network(statuses: { openai?: number; whisper?: number } = {}) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
      form: init?.body as FormData,
    });
    if (url === `${OPENAI}/audio/transcriptions`) {
      return statuses.openai
        ? new Response("no", { status: statuses.openai })
        : Response.json({ text: " from openai " });
    }
    if (url === `${WHISPER}/v1/audio/transcriptions`) {
      if (statuses.whisper === -1) throw new TypeError("connection refused");
      return statuses.whisper
        ? new Response("no", { status: statuses.whisper })
        : Response.json({ text: " I decided ", words: WORDS });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { calls, fetch };
}

const openai = openAiTarget({ apiKey: "sk-secret", baseUrl: OPENAI });
const whisper = whisperTarget(`${WHISPER}/`, "Systran/faster-whisper-small.en");

describe("transcribe", () => {
  test("asks whisper for word timestamps and returns words with confidence", async () => {
    const { calls, fetch } = network();
    const transcript = await transcribe(AUDIO, whisper, fetch);

    expect(transcript).toEqual({ text: "I decided", words: WORDS });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.auth).toBeNull();
    const form = calls[0]?.form;
    expect(form?.get("model")).toBe("Systran/faster-whisper-small.en");
    expect(form?.get("language")).toBe("en");
    expect(form?.get("response_format")).toBe("verbose_json");
    expect(form?.getAll("timestamp_granularities[]")).toEqual(["word"]);
  });

  test("a response without words still yields the text", async () => {
    const { calls, fetch } = network();
    const transcript = await transcribe(AUDIO, openai, fetch);
    expect(transcript).toEqual({ text: "from openai", words: [] });
    expect(calls[0]?.auth).toBe("Bearer sk-secret");
    expect(calls[0]?.form.get("model")).toBe(STT_MODEL);
  });

  test("a malformed body is a TranscriptionError", async () => {
    const fetch: FetchLike = async () => Response.json({ nope: true });
    expect(transcribe(AUDIO, whisper, fetch)).rejects.toBeInstanceOf(TranscriptionError);
  });
});

describe("transcribeWithFallback", () => {
  test("uses the first target and never touches the rest", async () => {
    const { calls, fetch } = network();
    const transcript = await transcribeWithFallback(AUDIO, [openai, whisper], fetch);
    expect(transcript.text).toBe("from openai");
    expect(calls.map((call) => call.url)).toEqual([`${OPENAI}/audio/transcriptions`]);
  });

  test("falls through to local whisper when the key fails", async () => {
    const { calls, fetch } = network({ openai: 401 });
    const failed: string[] = [];
    const transcript = await transcribeWithFallback(AUDIO, [openai, whisper], fetch, (target) =>
      failed.push(target.id),
    );
    expect(transcript.words).toEqual(WORDS);
    expect(failed).toEqual(["openai"]);
    expect(calls).toHaveLength(2);
  });

  test("local whisper alone works with no key", async () => {
    const { fetch } = network();
    expect((await transcribeWithFallback(AUDIO, [whisper], fetch)).text).toBe("I decided");
  });

  test("when every engine fails the last error is thrown, without keys", async () => {
    const { fetch } = network({ openai: 500, whisper: -1 });
    const error = await transcribeWithFallback(AUDIO, [openai, whisper], fetch).catch((e) => e);
    expect(error).toBeInstanceOf(TranscriptionError);
    expect(String(error.message)).not.toContain("sk-secret");
  });
});

describe("parseSttEnv", () => {
  test("defaults: no local STT, small.en", () => {
    expect(parseSttEnv({})).toEqual({
      STT_URL: undefined,
      STT_MODEL: "Systran/faster-whisper-small.en",
    });
  });

  test("blank values count as unset; a set URL is kept", () => {
    expect(parseSttEnv({ STT_URL: "", STT_MODEL: "" }).STT_URL).toBeUndefined();
    expect(parseSttEnv({ STT_URL: "http://stt:8000" }).STT_URL).toBe("http://stt:8000");
  });
});
