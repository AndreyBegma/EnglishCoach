import { CALLBACK_VERSION, MAX_CALLBACK_BYTES } from "../bot/callbacks";

/**
 * Grammar's own inline-button codec. Wire format: `<CALLBACK_VERSION>:g:<route>[:<arg>…]`, within
 * Telegram's 64 bytes. The shared `parseCallback` does not know it and returns undefined, so the
 * hub and settings composers pass these updates on to `grammarHandlers`.
 */
export type GrammarCallback =
  /** A syllabus topic id (`g015`); null for Mixed. */
  | { type: "topic"; id: string | null }
  | { type: "answer"; question: number; option: number }
  | { type: "retry" }
  | { type: "stop" };

const PREFIX = `${CALLBACK_VERSION}:g`;
const int = /^\d{1,3}$/;
const topicId = /^g\d{3}$/;

export function encodeGrammarCallback(callback: GrammarCallback): string {
  let data: string;
  switch (callback.type) {
    case "topic":
      data = `${PREFIX}:t:${callback.id ?? "m"}`;
      break;
    case "answer":
      data = `${PREFIX}:a:${callback.question}:${callback.option}`;
      break;
    case "retry":
      data = `${PREFIX}:r`;
      break;
    case "stop":
      data = `${PREFIX}:x`;
      break;
  }
  if (Buffer.byteLength(data) > MAX_CALLBACK_BYTES) {
    throw new Error(`callback data longer than ${MAX_CALLBACK_BYTES} bytes`);
  }
  return data;
}

/** Parses grammar callback data; undefined for anything that is not a current grammar button. */
export function parseGrammarCallback(data: string | undefined): GrammarCallback | undefined {
  if (!data || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) return undefined;
  const [version, prefix, route, ...args] = data.split(":");
  if (version !== String(CALLBACK_VERSION) || prefix !== "g") return undefined;

  if (route === "t" && args.length === 1) {
    if (args[0] === "m") return { type: "topic", id: null };
    if (args[0] !== undefined && topicId.test(args[0])) return { type: "topic", id: args[0] };
  }
  if (route === "a" && args.length === 2 && int.test(args[0] ?? "") && int.test(args[1] ?? "")) {
    return { type: "answer", question: Number(args[0]), option: Number(args[1]) };
  }
  if (route === "r" && args.length === 0) return { type: "retry" };
  if (route === "x" && args.length === 0) return { type: "stop" };
  return undefined;
}
