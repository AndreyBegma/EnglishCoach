import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { LlmOutputError } from "../../src/llm/errors";
import { pickModel } from "../../src/llm/models";
import {
  type Attempt,
  completeWithRepair,
  parseJsonOutput,
  repairPrompt,
  toJsonSchema,
} from "../../src/llm/structured";
import type { ChatMessage } from "../../src/llm/types";

const schema = z.object({ answer: z.string(), score: z.number().int() });
const question: ChatMessage[] = [{ role: "user", content: "Q" }];

/** An attempt that replays canned outputs and records what it was sent. */
function scripted(outputs: string[]) {
  const calls: ChatMessage[][] = [];
  const attempt: Attempt = async (messages) => {
    calls.push(messages);
    return { text: outputs[calls.length - 1] ?? "", usage: { input: 10, output: 5 } };
  };
  return { attempt, calls };
}

describe("parseJsonOutput", () => {
  test("accepts plain JSON and a fenced block", () => {
    expect(parseJsonOutput('{"answer":"a","score":1}', schema)).toEqual({
      ok: true,
      data: { answer: "a", score: 1 },
    });
    expect(parseJsonOutput('```json\n{"answer":"a","score":1}\n```', schema).ok).toBe(true);
  });

  test("reports invalid JSON and schema violations as issues", () => {
    const notJson = parseJsonOutput("Sure! Here you go", schema);
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.issues).toContain("not valid JSON");

    const wrongShape = parseJsonOutput('{"answer":"a","score":1.5}', schema);
    expect(wrongShape.ok).toBe(false);
    if (!wrongShape.ok) expect(wrongShape.issues).toContain("score");
  });
});

describe("completeWithRepair", () => {
  test("returns the first valid output without a repair turn", async () => {
    const { attempt, calls } = scripted(['{"answer":"a","score":1}']);
    const result = await completeWithRepair("openai", question, schema, attempt);
    expect(result).toEqual({ data: { answer: "a", score: 1 }, usage: { input: 10, output: 5 } });
    expect(calls).toHaveLength(1);
  });

  test("repairs once with the failed output and the validation issues", async () => {
    const { attempt, calls } = scripted(['{"answer":"a"}', '{"answer":"a","score":2}']);
    const result = await completeWithRepair("openai", question, schema, attempt);

    expect(result.data).toEqual({ answer: "a", score: 2 });
    expect(result.usage).toEqual({ input: 20, output: 10 });
    expect(calls).toHaveLength(2);
    const repair = calls[1] ?? [];
    expect(repair.slice(0, 1)).toEqual(question);
    expect(repair[1]).toEqual({ role: "assistant", content: '{"answer":"a"}' });
    expect(repair[2]?.role).toBe("user");
    expect(repair[2]?.content).toStartWith("Your previous output failed validation: ");
    expect(repair[2]?.content).toContain("score");
    expect(repair[2]?.content).toEndWith(". Return only valid JSON.");
  });

  test("throws LlmOutputError after the repair also fails, and stops there", async () => {
    const { attempt, calls } = scripted(["nope", "still nope", '{"answer":"a","score":1}']);
    const error = await completeWithRepair("anthropic", question, schema, attempt).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as LlmOutputError).kind).toBe("anthropic");
    expect((error as LlmOutputError).issues).toContain("not valid JSON");
    expect(calls).toHaveLength(2);
  });

  test("repairPrompt has the agreed wording", () => {
    expect(repairPrompt("x is required")).toBe(
      "Your previous output failed validation: x is required. Return only valid JSON.",
    );
  });
});

describe("toJsonSchema", () => {
  test("derives an object schema without the $schema marker", () => {
    const jsonSchema = toJsonSchema(schema);
    expect(jsonSchema.$schema).toBeUndefined();
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.required).toEqual(["answer", "score"]);
  });
});

describe("pickModel", () => {
  test("user model wins, then the request model, then the tier default", () => {
    expect(pickModel("anthropic", { userModel: "mine", requestModel: "req", tier: "fast" })).toBe(
      "mine",
    );
    expect(pickModel("anthropic", { requestModel: "req", tier: "fast" })).toBe("req");
    expect(pickModel("anthropic", { tier: "fast" })).toBe("claude-haiku-5-5");
    expect(pickModel("anthropic", {})).toBe("claude-sonnet-5-5");
    expect(pickModel("openai", { tier: "fast" })).toBe("gpt-6-luna");
    expect(pickModel("claude-code", { userModel: null, tier: "smart" })).toBe("sonnet");
  });
});
