import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { describeProviderError, LlmProviderError } from "../../src/llm/errors";
import { createAnthropicProvider, WORKSPACE_HEADER } from "../../src/llm/providers/anthropic";

const apiKey = "sk-ant-usr-secretsecretsecret-a1b2";
const workspaceId = "wrkspc_01TestWorkspace";
const WORKSPACE_MESSAGE =
  "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.";

type Seen = { method: string; path: string; workspace: string | null };

/**
 * The Anthropic API as an unscoped user key meets it: every request without the workspace header
 * is a 400. The real SDK runs on top, so this checks the headers it actually sends.
 */
function fakeApi() {
  const seen: Seen[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const workspace = request.headers.get(WORKSPACE_HEADER);
    seen.push({ method: request.method, path: url.pathname, workspace });
    if (!workspace) {
      return json(400, {
        type: "error",
        error: { type: "invalid_request_error", message: WORKSPACE_MESSAGE },
      });
    }
    if (url.pathname === "/v1/models") {
      return json(200, {
        data: [{ id: "claude-sonnet-5-5", type: "model", display_name: "x", created_at: "" }],
        has_more: false,
        first_id: "claude-sonnet-5-5",
        last_id: "claude-sonnet-5-5",
      });
    }
    return json(200, {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: '{"ok": true}' }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, seen };
}

const ping = {
  system: "s",
  messages: [{ role: "user" as const, content: "ping" }],
  schema: z.object({ ok: z.boolean() }),
  model: "claude-sonnet-5-5",
};

describe("anthropic workspace ID", () => {
  test("without it, the 400 is described as the workspace class with the provider's words", async () => {
    const api = fakeApi();
    const provider = createAnthropicProvider({ apiKey, fetch: api.fetch });

    const error = await provider.complete(ping).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmProviderError);
    const described = describeProviderError(error);
    expect(described.class).toBe("workspace");
    expect(described.key).toBe("provider-error-workspace");
    expect(described.detail).toBe(WORKSPACE_MESSAGE);
    expect(JSON.stringify(described)).not.toContain(apiKey);
  });

  test("with it, every request carries the header — the model listing included", async () => {
    const api = fakeApi();
    const provider = createAnthropicProvider({ apiKey, workspaceId, fetch: api.fetch });

    expect(await provider.listModels?.()).toEqual(["claude-sonnet-5-5"]);
    expect((await provider.complete(ping)).data).toEqual({ ok: true });
    expect(api.seen.map((request) => request.path)).toEqual(["/v1/models", "/v1/messages"]);
    expect(api.seen.every((request) => request.workspace === workspaceId)).toBe(true);
  });

  test("no header at all when no workspace is set", async () => {
    const api = fakeApi();
    const provider = createAnthropicProvider({ apiKey, workspaceId: null, fetch: api.fetch });
    await provider.complete(ping).catch(() => undefined);
    expect(api.seen[0]?.workspace).toBeNull();
  });
});
