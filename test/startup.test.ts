import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "src", "index.ts");

test("exits with a one-line error naming TELEGRAM_BOT_TOKEN when it is missing", async () => {
  const proc = Bun.spawn([process.execPath, ENTRY], {
    // Bun auto-loads `.env` from the working directory; run elsewhere so a developer's .env
    // cannot supply the token this test removes.
    cwd: tmpdir(),
    // A clean environment: only what the process needs to start, and no token.
    env: {
      PATH: process.env.PATH ?? "",
      DATABASE_URL: "postgres://coach:coach@127.0.0.1:1/coach",
      REDIS_URL: "redis://127.0.0.1:1",
      MASTER_KEY: Buffer.alloc(32, 1).toString("base64"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stderr, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
  ]);

  expect(exitCode).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toBe("Invalid environment: TELEGRAM_BOT_TOKEN is required\n");
}, 15_000);
