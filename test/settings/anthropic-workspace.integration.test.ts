import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Callback, encodeCallback } from "../../src/bot/callbacks";
import type { Database } from "../../src/db/client";
import { getHub } from "../../src/db/repositories/hub";
import { getActiveProviderConfig } from "../../src/db/repositories/providers";
import { findUserByTelegramId } from "../../src/db/repositories/users";
import type { ProviderFactories } from "../../src/llm";
import { createAnthropicProvider, WORKSPACE_HEADER } from "../../src/llm/providers/anthropic";
import { createHarness } from "../bot/harness";
import { createTestDatabase, testServerUrl } from "../db/test-database";

const USER_KEY = "sk-ant-usr-unscoped-user-key-3333";
const WORKSPACE_ID = "wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ";

type Seen = { path: string; workspace: string | null };

/**
 * The Anthropic API over HTTP as an unscoped user key meets it: any request without
 * `anthropic-workspace-id` is a 400. The real SDK and provider run on top of it.
 */
function unscopedKeyApi(seen: Seen[]): typeof fetch {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    const workspace = request.headers.get(WORKSPACE_HEADER);
    seen.push({ path, workspace });
    if (!workspace) {
      return json(400, {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: `This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.`,
        },
      });
    }
    if (path === "/v1/models") {
      return json(200, {
        data: [{ id: "claude-sonnet-5-5", type: "model", display_name: "x", created_at: "" }],
        has_more: false,
        first_id: null,
        last_id: null,
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
  }) as typeof fetch;
}

const unused = () => {
  throw new Error("not used by this test");
};

describe.skipIf(!testServerUrl)("anthropic workspace ID through Settings", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase(testServerUrl ?? "");
  });
  afterAll(() => database.close());

  test("a 400 workspace error asks for the ID; once set, every request carries the header", async () => {
    const seen: Seen[] = [];
    const factories: ProviderFactories = {
      anthropic: (options) => createAnthropicProvider({ ...options, fetch: unscopedKeyApi(seen) }),
      openai: unused,
      claudeCode: unused,
    };
    const telegramId = 930_001;
    const h = createHarness(database.db, { adminIds: [telegramId], llmFactories: factories });
    await h.say(telegramId, "/menu");
    const user = await findUserByTelegramId(database.db, telegramId);
    const hub = user && (await getHub(database.db, user.id));
    if (!user || !hub) throw new Error("user or hub not created");
    const press = (callback: Callback) =>
      h.press(telegramId, hub.messageId, encodeCallback(callback));
    const hubText = () => h.telegram.chat(telegramId).get(hub.messageId)?.text ?? "";
    const labels = () => JSON.stringify(h.telegram.chat(telegramId).get(hub.messageId));

    // The key itself is accepted: a 400 from the listing is not a rejected key.
    await press({ type: "provider", choice: "anthropic" });
    await h.say(telegramId, USER_KEY);
    expect(hubText()).toContain("Key checked and saved.");

    // The test call fails with the workspace error, and the hub turns into the workspace prompt.
    await press({ type: "provider-test" });
    expect(hubText()).toContain("This key is not bound to a workspace (HTTP 400)");
    expect(hubText()).toContain("Provider says: This API key is not scoped to a workspace");
    expect(hubText()).toContain("Send the Anthropic workspace ID");

    // A key pasted into the prompt is refused and never stored.
    await h.say(telegramId, USER_KEY);
    expect(hubText()).toContain("That does not look like a workspace ID.");
    expect((await getActiveProviderConfig(database.db, user.id))?.workspaceId).toBeNull();

    const deletesBefore = h.telegram.callsOf("deleteMessage").length;
    await h.say(telegramId, WORKSPACE_ID);
    expect(h.telegram.callsOf("deleteMessage").length).toBe(deletesBefore + 1);
    expect(hubText()).toContain("Workspace ID saved.");
    expect(hubText()).toContain(`Workspace: ${WORKSPACE_ID}`);
    expect((await getActiveProviderConfig(database.db, user.id))?.workspaceId).toBe(WORKSPACE_ID);

    seen.length = 0;
    await press({ type: "provider-test" });
    expect(hubText()).toMatch(/Provider works \(\d+ ms\)/);
    await press({ type: "settings", page: "model" });
    expect(seen.map((request) => request.path)).toEqual(["/v1/messages", "/v1/models"]);
    expect(seen.every((request) => request.workspace === WORKSPACE_ID)).toBe(true);

    // Cleared from the provider screen: requests go out without the header again.
    await press({ type: "settings", page: "provider" });
    expect(labels()).toContain("Clear workspace");
    await press({ type: "provider-workspace-clear" });
    expect(hubText()).toContain("Workspace ID cleared.");
    expect((await getActiveProviderConfig(database.db, user.id))?.workspaceId).toBeNull();

    // No key material anywhere the user or the logs see.
    expect(JSON.stringify(h.telegram.calls)).not.toContain(USER_KEY);
    expect(h.logs.join("\n")).not.toContain(USER_KEY);
  });
});
