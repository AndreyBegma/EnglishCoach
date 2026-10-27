import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  /** The validated answer when `--json-schema` was given. */
  structured_output: z.unknown().optional(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().optional(),
});

/** The answer as text: the structured output when the CLI produced one, else the result text. */
export function answerText(result: z.infer<typeof cliResult>): string {
  return result.structured_output === undefined
    ? result.result
    : JSON.stringify(result.structured_output);
}

/**
 * `--output-format json` prints one result object, or — when the host's settings turn verbose mode
 * on — an array of every session event, whose last `type: "result"` entry is that same object.
 */
export function resultEvent(output: unknown): unknown {
  if (!Array.isArray(output)) return output;
  return output.findLast(
    (event: unknown) =>
      typeof event === "object" && event !== null && "type" in event && event.type === "result",
  );
}

/** The CLI takes one prompt; a multi-turn conversation is rendered as a transcript. */
export function renderConversation(messages: ChatMessage[]): string {
  if (messages.length === 1 && messages[0]?.role === "user") return messages[0].content;
  return messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n");
}

export function claudeArgs(
  model: string,
  system: string,
  schema: Record<string, unknown>,
): string[] {
  // The CLI is a plain completion endpoint, isolated from the host's Claude Code setup:
  // - `--tools ""` disables every built-in tool;
  // - `--setting-sources ""` loads no user/project/local settings: no hooks, no host `CLAUDE.md`;
  // - `--strict-mcp-config` with an empty config loads no MCP servers (host or claude.ai);
  // - `--disable-slash-commands` loads no skills or commands;
  // - `--no-session-persistence` leaves no session on disk.
  // `--bare` would also isolate, but it ignores the subscription login this provider exists for.
  // `--json-schema` makes the CLI validate the answer and return it as `structured_output`.
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
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
    "--disable-slash-commands",
    "--no-session-persistence",
    "--json-schema",
    JSON.stringify(schema),
  ];
}

/**
 * Runs the Claude Code CLI on the host (the host's Claude subscription pays). System prompt via
 * `--system-prompt`, conversation on stdin, no tools, no host settings/MCP/hooks/`CLAUDE.md`
 * (see `claudeArgs`), run in an empty temp directory, killed after `timeoutMs`.
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
      const schema = toJsonSchema(req.schema);
      const system = `${req.system}\n\nRespond with only a JSON value that matches this JSON Schema, with no prose around it:\n${JSON.stringify(schema)}`;

      return completeWithRepair("claude-code", req.messages, req.schema, async (messages) => {
        // An empty cwd, so no project `CLAUDE.md` or `.claude/` is discovered from the server's dir.
        const cwd = await mkdtemp(join(tmpdir(), "englishcoach-claude-"));
        let proc: Bun.Subprocess<Uint8Array, "pipe", "pipe">;
        try {
          proc = Bun.spawn([...options.command, ...claudeArgs(model, system, schema)], {
            cwd,
            stdin: new TextEncoder().encode(renderConversation(messages)),
            stdout: "pipe",
            stderr: "pipe",
          });
        } catch (error) {
          await rm(cwd, { recursive: true, force: true });
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
            parsed = cliResult.parse(resultEvent(JSON.parse(stdout)));
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
            text: answerText(parsed),
            usage:
              parsed.usage?.input_tokens !== undefined && parsed.usage.output_tokens !== undefined
                ? { input: parsed.usage.input_tokens, output: parsed.usage.output_tokens }
                : undefined,
          };
        } finally {
          clearTimeout(timer);
          await rm(cwd, { recursive: true, force: true });
        }
      });
    },

    async listModels() {
      return CURATED_MODELS["claude-code"];
    },
  };
}
