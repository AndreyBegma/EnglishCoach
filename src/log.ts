const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export type LogLevel = keyof typeof LEVELS;
export type LogFields = Record<string, unknown>;

export const REDACTED = "[redacted]";

/** Any key whose name contains one of these words is redacted, at any depth, case-insensitively. */
const SENSITIVE_KEY = /key|token|secret/i;

/**
 * Returns a copy of `value` with every sensitive key's value replaced by `REDACTED`.
 * Never mutates the input. Errors are flattened to plain objects so their fields are redacted too.
 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const copy = value.map((item) => redact(item, seen));
    seen.delete(value);
    return copy;
  }

  const source: Record<string, unknown> =
    value instanceof Error
      ? { ...value, name: value.name, message: value.message, stack: value.stack }
      : (value as Record<string, unknown>);

  const copy: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(source)) {
    copy[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(field, seen);
  }
  seen.delete(value);
  return copy;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: LogFields;
  /** Where a finished line goes. Defaults to stdout (stderr for warn and error). */
  write?: (line: string, level: LogLevel) => void;
}

function defaultWrite(line: string, level: LogLevel): void {
  if (LEVELS[level] >= LEVELS.warn) process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/** A thin JSON-lines logger. Every field, including bindings, passes through `redact`. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVELS[options.level ?? "info"];
  const bindings = options.bindings ?? {};
  const write = options.write ?? defaultWrite;

  const log = (level: LogLevel, message: string, fields?: LogFields) => {
    if (LEVELS[level] < threshold) return;
    const entry = redact({ ...bindings, ...fields }) as LogFields;
    write(JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...entry }), level);
  };

  return {
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
    child: (extra) => createLogger({ ...options, bindings: { ...bindings, ...extra } }),
  };
}
