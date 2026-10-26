import { CALLBACK_VERSION, MAX_CALLBACK_BYTES } from "../bot/callbacks";

/** The two daily sets a routine prompt can start. */
export type RoutineSet = "morning" | "evening";

/**
 * The routine prompt's inline-button codec. Wire format: `<CALLBACK_VERSION>:rt:<route>[:<arg>]`.
 * The shared `parseCallback` does not know it, so other composers pass these updates on.
 */
export type RoutineCallback = { type: "start"; set: RoutineSet } | { type: "later" };

const PREFIX = `${CALLBACK_VERSION}:rt`;
const SET_CODE: Record<RoutineSet, string> = { morning: "m", evening: "e" };

export function encodeRoutineCallback(callback: RoutineCallback): string {
  const data = callback.type === "start" ? `${PREFIX}:s:${SET_CODE[callback.set]}` : `${PREFIX}:l`;
  if (Buffer.byteLength(data) > MAX_CALLBACK_BYTES) {
    throw new Error(`callback data longer than ${MAX_CALLBACK_BYTES} bytes`);
  }
  return data;
}

/** Parses routine callback data; undefined for anything that is not a current routine button. */
export function parseRoutineCallback(data: string | undefined): RoutineCallback | undefined {
  if (!data || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) return undefined;
  const [version, prefix, route, ...args] = data.split(":");
  if (version !== String(CALLBACK_VERSION) || prefix !== "rt") return undefined;

  if (route === "s" && args.length === 1) {
    if (args[0] === "m") return { type: "start", set: "morning" };
    if (args[0] === "e") return { type: "start", set: "evening" };
  }
  if (route === "l" && args.length === 0) return { type: "later" };
  return undefined;
}
