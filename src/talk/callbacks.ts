import { z } from "zod";
import { CALLBACK_VERSION, MAX_CALLBACK_BYTES } from "../bot/callbacks";

/**
 * Talk's inline-button payloads, in the shared wire format `<version>:t:<route>:<args>` (≤ 64
 * bytes). The shared codec in `bot/callbacks.ts` ignores them (unknown route → undefined), so
 * they fall through to the Talk composer.
 */
export type TalkCallback =
  /** `topic` is an index into the suggestions, or "free" for no topic. */
  | { type: "pick"; sessionId: number; topic: number | "free" }
  | { type: "finish"; sessionId: number };

const id = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number);

const route = z.union([
  z
    .tuple([z.literal("t"), z.literal("p"), id, z.union([z.literal("free"), id])])
    .transform(([, , sessionId, topic]) => ({ type: "pick" as const, sessionId, topic })),
  z
    .tuple([z.literal("t"), z.literal("f"), id])
    .transform(([, , sessionId]) => ({ type: "finish" as const, sessionId })),
]);

export function encodeTalkCallback(callback: TalkCallback): string {
  const parts: (string | number)[] = [CALLBACK_VERSION, "t"];
  if (callback.type === "pick") parts.push("p", callback.sessionId, callback.topic);
  else parts.push("f", callback.sessionId);
  const data = parts.join(":");
  if (Buffer.byteLength(data) > MAX_CALLBACK_BYTES) {
    throw new Error(`callback data longer than ${MAX_CALLBACK_BYTES} bytes`);
  }
  return data;
}

/** Parses Talk callback data; undefined for anything that is not one of ours. */
export function parseTalkCallback(data: string | undefined): TalkCallback | undefined {
  if (!data || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) return undefined;
  const [version, ...rest] = data.split(":");
  if (version !== String(CALLBACK_VERSION)) return undefined;
  const result = route.safeParse(rest);
  return result.success ? result.data : undefined;
}
