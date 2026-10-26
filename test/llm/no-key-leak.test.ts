import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import { scrubSecrets } from "../../src/llm/errors";
import { createOpenAiProvider } from "../../src/llm/providers/openai";
import { createLogger } from "../../src/log";

const root = join(import.meta.dir, "../..");
const apiKey = "sk-user-0123456789abcdef-zz99";

/** The code that ever holds a decrypted key. */
const keyHandlingFiles = [
  ...new Bun.Glob("src/llm/**/*.ts").scanSync(root),
  ...new Bun.Glob("src/crypto/**/*.ts").scanSync(root),
  "src/db/repositories/providers.ts",
];

describe("decrypted keys are never logged", () => {
  test("no key-handling module logs anything or writes to the console", async () => {
    expect(keyHandlingFiles.length).toBeGreaterThan(5);
    for (const file of keyHandlingFiles) {
      const source = await Bun.file(join(root, file)).text();
      expect({
        file,
        logs: /from\s+["'][./]*log["']|console\.|process\.std(out|err)/.test(source),
      }).toEqual({
        file,
        logs: false,
      });
    }
  });

  test("a provider error that echoed the key is logged without it", async () => {
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line) });
    const provider = createOpenAiProvider({
      apiKey,
      client: {
        chat: {
          completions: {
            create: async () => {
              throw Object.assign(new Error(`Incorrect API key provided: ${apiKey}`), {
                status: 401,
                headers: { authorization: `Bearer ${apiKey}` },
              });
            },
          },
        },
        models: { list: () => (async function* () {})() },
      },
    });

    const error = await provider
      .complete({ system: "s", messages: [{ role: "user", content: "u" }], schema: z.object({}) })
      .catch((caught: unknown) => caught);
    log.error("llm call failed", { error });
    log.error(String(error));

    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).not.toContain(apiKey);
  });

  test("the logger redacts a key passed as a field", () => {
    const lines: string[] = [];
    createLogger({ write: (line) => lines.push(line) }).info("config", {
      provider: { kind: "openai", apiKey },
    });
    expect(lines[0]).not.toContain(apiKey);
  });

  test("scrubSecrets removes known secrets and anything key-shaped", () => {
    expect(scrubSecrets(`bad key ${apiKey}`, [apiKey])).toBe("bad key [redacted]");
    expect(scrubSecrets("token sk-ant-api03-abcdefghij leaked")).toBe("token [redacted] leaked");
    expect(scrubSecrets("custom-secret-value", ["custom-secret-value"])).toBe("[redacted]");
  });
});
