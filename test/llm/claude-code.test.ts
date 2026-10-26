import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import { LlmOutputError, LlmProviderError } from "../../src/llm/errors";
import { createClaudeCodeProvider, renderConversation } from "../../src/llm/providers/claude-code";

const fake = join(import.meta.dir, "../fixtures/llm/fake-claude.ts");
const command = (mode: string) => [process.execPath, fake, mode];

const echoSchema = z.object({ argv: z.array(z.string()), stdin: z.string() });
const request = {
  system: "You are a grammar quiz.",
  messages: [{ role: "user" as const, content: "Start" }],
  schema: echoSchema,
};

function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("claude-code provider", () => {
  test("runs claude -p with JSON output, the model, the system prompt and no tools", async () => {
    const provider = createClaudeCodeProvider({ command: command("echo"), model: "opus" });
    const { data, usage } = await provider.complete(request);

    expect(provider.kind).toBe("claude-code");
    expect(usage).toEqual({ input: 11, output: 22 });
    expect(data.stdin).toBe("Start");
    const [print, outputFlag, format, modelFlag, model, systemFlag, system, toolsFlag, tools] =
      data.argv;
    expect([print, outputFlag, format, modelFlag, model]).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "opus",
    ]);
    expect(systemFlag).toBe("--system-prompt");
    expect(system).toStartWith("You are a grammar quiz.");
    expect(system).toContain("JSON Schema");
    expect([toolsFlag, tools]).toEqual(["--tools", ""]);
  });

  test("falls back to the tier default when no model is chosen", async () => {
    const provider = createClaudeCodeProvider({ command: command("echo") });
    const { data } = await provider.complete({ ...request, tier: "fast" });
    expect(data.argv[4]).toBe("haiku");
  });

  test("puts a multi-turn conversation on stdin as a transcript", () => {
    expect(
      renderConversation([
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Quiz me" },
      ]),
    ).toBe("User: Hi\n\nAssistant: Hello\n\nUser: Quiz me");
  });

  test("repairs invalid output once", async () => {
    const provider = createClaudeCodeProvider({ command: command("repair") });
    const { data, usage } = await provider.complete(request);
    expect(data.stdin).toBe("fixed");
    expect(usage).toEqual({ input: 22, output: 44 });
  });

  test("throws LlmOutputError when the output stays invalid", async () => {
    const provider = createClaudeCodeProvider({ command: command("invalid") });
    expect(await errorOf(provider.complete(request))).toBeInstanceOf(LlmOutputError);
  });

  test("a non-zero exit is an LlmProviderError carrying stderr", async () => {
    const error = await errorOf(
      createClaudeCodeProvider({ command: command("fail") }).complete(request),
    );
    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as Error).message).toContain("exited with 3");
    expect((error as Error).message).toContain("not logged in");
  });

  test("is_error and non-JSON stdout are LlmProviderErrors", async () => {
    const reported = await errorOf(
      createClaudeCodeProvider({ command: command("is-error") }).complete(request),
    );
    expect(reported).toBeInstanceOf(LlmProviderError);
    expect((reported as Error).message).toContain("Credit balance is too low");

    const garbage = await errorOf(
      createClaudeCodeProvider({ command: command("garbage") }).complete(request),
    );
    expect(garbage).toBeInstanceOf(LlmProviderError);
  });

  test("kills the process and fails after the timeout", async () => {
    const started = Date.now();
    const error = await errorOf(
      createClaudeCodeProvider({ command: command("hang"), timeoutMs: 300 }).complete(request),
    );
    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as Error).message).toContain("timed out after 300 ms");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test("a missing binary is an LlmProviderError, not a crash", async () => {
    const error = await errorOf(
      createClaudeCodeProvider({ command: ["/nonexistent/claude-binary"] }).complete(request),
    );
    expect(error).toBeInstanceOf(LlmProviderError);
  });

  test("listModels returns the CLI's aliases", async () => {
    expect(await createClaudeCodeProvider({ command: ["claude"] }).listModels?.()).toEqual([
      "opus",
      "sonnet",
      "haiku",
    ]);
  });
});
