import { CALLBACK_VERSION, MAX_CALLBACK_BYTES } from "../bot/callbacks";

/**
 * The size test's own inline-button codec. Wire format: `<CALLBACK_VERSION>:z:<route>[:<arg>…]`,
 * within Telegram's 64 bytes. `start` is the offer on the hub and on Progress; `answer` carries
 * the item number so a tap on an older item is "already answered"; option `n` is "I don't know".
 */
export type SizeTestCallback =
  | { type: "start" }
  | { type: "answer"; item: number; option: number | null }
  | { type: "stop" };

const PREFIX = `${CALLBACK_VERSION}:z`;
const int = /^\d{1,3}$/;

export function encodeSizeTestCallback(callback: SizeTestCallback): string {
  let data: string;
  switch (callback.type) {
    case "start":
      data = `${PREFIX}:s`;
      break;
    case "answer":
      data = `${PREFIX}:a:${callback.item}:${callback.option ?? "n"}`;
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

/** Parses size-test callback data; undefined for anything that is not a current size-test button. */
export function parseSizeTestCallback(data: string | undefined): SizeTestCallback | undefined {
  if (!data || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) return undefined;
  const [version, prefix, route, ...args] = data.split(":");
  if (version !== String(CALLBACK_VERSION) || prefix !== "z") return undefined;

  if (route === "s" && args.length === 0) return { type: "start" };
  if (route === "x" && args.length === 0) return { type: "stop" };
  if (route === "a" && args.length === 2 && int.test(args[0] ?? "")) {
    const option = args[1] === "n" ? null : int.test(args[1] ?? "") ? Number(args[1]) : undefined;
    if (option !== undefined) return { type: "answer", item: Number(args[0]), option };
  }
  return undefined;
}
