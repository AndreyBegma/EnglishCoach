import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scripts = join(import.meta.dir, "../../scripts");
const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "backup-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dumpName(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `coach-${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-030000.dump`;
}

function run(cmd: string[], env: Record<string, string> = {}) {
  const r = Bun.spawnSync(cmd, { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe("backup-rotate.sh", () => {
  test("keeps 7 daily, 4 weekly and 3 monthly dumps out of a year of dailies", () => {
    const dir = tmp();
    const end = Date.UTC(2026, 9, 27);
    for (let i = 0; i < 365; i++) {
      writeFileSync(join(dir, dumpName(new Date(end - i * 86_400_000))), "x");
    }
    writeFileSync(join(dir, "notes.txt"), "keep me");

    const r = run([join(scripts, "backup-rotate.sh"), dir]);
    expect(r.code).toBe(0);

    const left = readdirSync(dir)
      .filter((f) => f.endsWith(".dump"))
      .sort()
      .reverse();
    // The newest 7 days are all kept.
    for (let i = 0; i < 7; i++) expect(left).toContain(dumpName(new Date(end - i * 86_400_000)));
    // Newest per week / month adds at most 4 + 3 more; far fewer than the 365 we started with.
    expect(left.length).toBeGreaterThanOrEqual(7);
    expect(left.length).toBeLessThanOrEqual(14);
    expect(left).not.toContain(dumpName(new Date(end - 200 * 86_400_000)));
    // Three distinct months survive, the oldest being the month of the 3rd-newest month.
    const months = new Set(left.map((f) => f.slice(6, 12)));
    expect(months.has("202610")).toBe(true);
    expect(months.has("202609")).toBe(true);
    expect(months.has("202608")).toBe(true);
    expect(months.has("202607")).toBe(false);
    // Unrelated files are left alone.
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
  });

  test("keeps only the newest dump of a day", () => {
    const dir = tmp();
    writeFileSync(join(dir, "coach-20261027-030000.dump"), "a");
    writeFileSync(join(dir, "coach-20261027-150000.dump"), "b");
    run([join(scripts, "backup-rotate.sh"), dir]);
    expect(readdirSync(dir)).toEqual(["coach-20261027-150000.dump"]);
  });
});

describe("backup.sh", () => {
  function shimDir(pgDump: string, pgRestore: string): string {
    const bin = tmp();
    for (const [name, body] of [
      ["pg_dump", pgDump],
      ["pg_restore", pgRestore],
    ] as const) {
      const p = join(bin, name);
      writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(p, 0o755);
    }
    return bin;
  }

  test("fails loudly and leaves no partial file when pg_dump fails", () => {
    const out = tmp();
    const bin = shimDir('echo "boom" >&2; exit 2', "exit 0");
    const r = run([join(scripts, "backup.sh")], {
      BACKUP_DIR: out,
      PATH: `${bin}:${process.env.PATH}`,
      PGPASSWORD: "s3cret-password",
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain("BACKUP FAILED");
    expect(r.out + r.err).not.toContain("s3cret-password");
    expect(readdirSync(out)).toEqual([]);
  });

  test("writes a verified dump and rotates", () => {
    const out = tmp();
    const bin = shimDir(
      'while [ $# -gt 0 ]; do [ "$1" = -f ] && f="$2"; shift; done; echo data > "$f"',
      "exit 0",
    );
    mkdirSync(out, { recursive: true });
    const r = run([join(scripts, "backup.sh")], {
      BACKUP_DIR: out,
      PATH: `${bin}:${process.env.PATH}`,
    });
    expect(r.code).toBe(0);
    const files = readdirSync(out);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^coach-\d{8}-\d{6}\.dump$/);
  });
});
