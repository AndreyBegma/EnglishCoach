import { prettifyError, type ZodType, z } from "zod";
import { LlmOutputError } from "./errors";
import type { ChatMessage, CompletionResult, ProviderKind, Usage } from "./types";

export type ParseResult<T> = { ok: true; data: T } | { ok: false; issues: string };

/** Parses model text as JSON (tolerating a ```json fence around it) and validates it with zod. */
export function parseJsonOutput<T>(text: string, schema: ZodType<T>): ParseResult<T> {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  let value: unknown;
  try {
    value = JSON.parse(fenced?.[1] ?? text);
  } catch (error) {
    return { ok: false, issues: `not valid JSON (${(error as Error).message})` };
  }
  return validateOutput(value, schema);
}

export function validateOutput<T>(value: unknown, schema: ZodType<T>): ParseResult<T> {
  const result = schema.safeParse(value);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, issues: prettifyError(result.error) };
}

/** The JSON Schema a provider hands to the model. */
export function toJsonSchema(schema: ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema, { io: "output" });
  return jsonSchema;
}

export function repairPrompt(issues: string): string {
  return `Your previous output failed validation: ${issues}. Return only valid JSON.`;
}

/** One model call: the raw output as text (what goes back into a repair turn) and its usage. */
export type Attempt = (messages: ChatMessage[]) => Promise<{ text: string; usage?: Usage }>;

function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  return { input: a.input + b.input, output: a.output + b.output };
}

/**
 * Runs `attempt`, validates its output, and on failure gives the model exactly one repair turn
 * (its output plus the validation issues). A second failure is an `LlmOutputError`.
 */
export async function completeWithRepair<T>(
  kind: ProviderKind,
  messages: ChatMessage[],
  schema: ZodType<T>,
  attempt: Attempt,
): Promise<CompletionResult<T>> {
  const first = await attempt(messages);
  const parsed = parseJsonOutput(first.text, schema);
  if (parsed.ok) return { data: parsed.data, usage: first.usage };

  const second = await attempt([
    ...messages,
    { role: "assistant", content: first.text },
    { role: "user", content: repairPrompt(parsed.issues) },
  ]);
  const usage = addUsage(first.usage, second.usage);
  const repaired = parseJsonOutput(second.text, schema);
  if (repaired.ok) return { data: repaired.data, usage };
  throw new LlmOutputError(kind, repaired.issues);
}
