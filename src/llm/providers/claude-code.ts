import { z } from "zod";
import { LlmProviderError } from "../errors";
import { CURATED_MODELS, pickModel } from "../models";
import { completeWithRepair, toJsonSchema } from "../structured";
import type { ChatMessage, CompletionRequest, LlmProvider } from "../types";

const DEFAULT_TIMEOUT_MS = 120_000;

export type ClaudeCodeProviderOptions = {
  /** The CLI as argv, e.g. `["claude"]` from CLAUDE_BIN, or `["bun", "fake.ts"]` in tests. */
  command: string[];
  /** The user's (or server's) chosen model; wins over the request's model and tier. */
  model?: string | null;
  timeoutMs?: number;
};

/** The part of `claude -p --output-format json` this provider reads. */
const cliResult = z.object({
  is_error: z.boolean().optional(),
  result: z.string(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().optional(),
});

/** The CLI takes one prompt; a multi-turn conversation is rendered as a transcript. */
export function renderConversation(messages: ChatMessage[]): string {
  if (messages.length === 1 && messages[0]?.role === "user") return messages[0].content;
  return messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n");
}

export function claudeArgs(model: string, system: string): string[] {
  // `--tools ""` disables every built-in tool: the CLI is used as a plain completion endpoint.
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--system-prompt",
    system,
    "--tools",
    "",
  ];
}

/**
 * Runs the Claude Code CLI on the host (the host's Claude subscription pays). System prompt via
 * `--system-prompt`, conversation on stdin, no tools, killed after `timeoutMs`.
 */
export function createClaudeCodeProvider(options: ClaudeCodeProviderOptions): LlmProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    kind: "claude-code",

    async complete<T>(req: CompletionRequest<T>) {
      const model = pickModel("claude-code", {
        userModel: options.model,
        requestModel: req.model,
        tier: req.tier,
      });
      // `req.temperature` is ignored: `claude -p` has no sampling flag, so the CLI default applies.
      const system = `${req.system}\n\nRespond with only a JSON value that matches this JSON Schema, with no prose around it:\n${JSON.stringify(toJsonSchema(req.schema))}`;

      return completeWithRepair("claude-code", req.messages, req.schema, async (messages) => {
        let proc: Bun.Subprocess<Uint8Array, "pipe", "pipe">;
        try {
          proc = Bun.spawn([...options.command, ...claudeArgs(model, system)], {
            stdin: new TextEncoder().encode(renderConversation(messages)),
            stdout: "pipe",
            stderr: "pipe",
          });
        } catch (error) {
          throw new LlmProviderError(
            "claude-code",
            `claude could not be started: ${String(error)}`,
          );
        }
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, timeoutMs);

        try {
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);
          if (timedOut) {
            throw new LlmProviderError("claude-code", `claude timed out after ${timeoutMs} ms`);
          }
          if (exitCode !== 0) {
            const detail = (stderr.trim() || stdout.trim()).slice(0, 500);
            throw new LlmProviderError("claude-code", `claude exited with ${exitCode}: ${detail}`);
          }

          let parsed: z.infer<typeof cliResult>;
          try {
            parsed = cliResult.parse(JSON.parse(stdout));
          } catch {
            throw new LlmProviderError(
              "claude-code",
              "claude printed output that is not its JSON result",
            );
          }
          if (parsed.is_error) {
            throw new LlmProviderError(
              "claude-code",
              `claude reported an error: ${parsed.result.slice(0, 500)}`,
            );
          }
          return {
            text: parsed.result,
            usage:
              parsed.usage?.input_tokens !== undefined && parsed.usage.output_tokens !== undefined
                ? { input: parsed.usage.input_tokens, output: parsed.usage.output_tokens }
                : undefined,
          };
        } finally {
          clearTimeout(timer);
        }
      });
    },

    async listModels() {
      return CURATED_MODELS["claude-code"];
    },
  };
}
