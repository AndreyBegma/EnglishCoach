import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "../..");
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "deploy-test-"));
  dirs.push(dir);
  return dir;
}

function stub(binDir: string, name: string, body: string) {
  const path = join(binDir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const r = Bun.spawnSync(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

/** A fake checkout with the real deploy.sh and stubbed docker/curl/git that log their argv. */
function fakeHost(options: { healthy: boolean; dirty?: boolean; env?: boolean }) {
  const root = tmp();
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  copyFileSync(join(repo, "scripts/deploy.sh"), join(root, "scripts/deploy.sh"));
  if (options.env !== false)
    writeFileSync(join(root, ".env"), "TELEGRAM_BOT_TOKEN=tok-SECRET-123\n");
  const log = join(root, "calls.log");
  const bin = join(root, "bin");
  stub(bin, "docker", `echo "docker $*" >> "${log}"; exit 0`);
  stub(bin, "curl", options.healthy ? `echo "curl $*" >> "${log}"; exit 0` : "exit 22");
  stub(
    bin,
    "git",
    `echo "git $*" >> "${log}"
case "$1" in
  status) ${options.dirty ? 'echo " M src/x.ts"' : "true"} ;;
  branch) echo develop ;;
  rev-parse) echo abc1234 ;;
esac
exit 0`,
  );
  stub(bin, "sleep", "exit 0");
  const path = `${bin}:${process.env.PATH}`;
  const deploy = (env: Record<string, string> = {}) =>
    run(["bash", join(root, "scripts/deploy.sh")], root, { PATH: path, ...env });
  return { root, deploy, calls: () => readFileSync(log, "utf8") };
}

describe("deploy.sh", () => {
  test("pulls develop, builds with the production override, waits for /health and prints status", () => {
    const host = fakeHost({ healthy: true });
    const r = host.deploy({ HTTP_HOST_PORT: "19999" });
    expect(r.code).toBe(0);
    const calls = host.calls();
    expect(calls).toContain("git pull --quiet --ff-only origin develop");
    expect(calls).toContain(
      "docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans",
    );
    expect(calls).toContain("http://127.0.0.1:19999/health");
    expect(r.out).toContain("deploy: healthy");
  });

  test("never prints .env values", () => {
    const host = fakeHost({ healthy: true });
    const r = host.deploy();
    expect(r.out + r.err).not.toContain("tok-SECRET-123");
  });

  test("is idempotent: a second run succeeds the same way", () => {
    const host = fakeHost({ healthy: true });
    expect(host.deploy().code).toBe(0);
    expect(host.deploy().code).toBe(0);
  });

  test("fails loudly, non-zero, when /health never answers", () => {
    const host = fakeHost({ healthy: false });
    const r = host.deploy({ DEPLOY_TIMEOUT: "0" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("DEPLOY FAILED");
    expect(r.err).toContain("/health did not answer 200");
    expect(host.calls()).toContain("logs --tail 30 app");
    expect(r.out + r.err).not.toContain("tok-SECRET-123");
  });

  test("refuses to deploy over local changes", () => {
    const host = fakeHost({ healthy: true, dirty: true });
    const r = host.deploy();
    expect(r.code).toBe(1);
    expect(r.err).toContain("local changes");
    expect(host.calls()).not.toContain("up -d");
  });

  test("DEPLOY_SKIP_PULL=1 deploys the tree as is, without touching git remotes", () => {
    const host = fakeHost({ healthy: true, dirty: true });
    const r = host.deploy({ DEPLOY_SKIP_PULL: "1" });
    expect(r.code).toBe(0);
    expect(host.calls()).not.toContain("git fetch");
  });

  test("fails without a .env", () => {
    const host = fakeHost({ healthy: true, env: false });
    const r = host.deploy();
    expect(r.code).toBe(1);
    expect(r.err).toContain(".env is missing");
  });

  test("reads only the port from .env", () => {
    const host = fakeHost({ healthy: true });
    writeFileSync(
      join(host.root, ".env"),
      "HTTP_HOST_PORT='18123'\nTELEGRAM_BOT_TOKEN=tok-SECRET-123\n",
    );
    const r = host.deploy();
    expect(r.code).toBe(0);
    expect(host.calls()).toContain("http://127.0.0.1:18123/health");
  });
});

describe("entrypoint.sh", () => {
  function entrypoint(failStep?: string) {
    const root = tmp();
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "bin"));
    copyFileSync(join(repo, "scripts/entrypoint.sh"), join(root, "scripts/entrypoint.sh"));
    const log = join(root, "calls.log");
    stub(
      join(root, "bin"),
      "bun",
      `echo "bun $*" >> "${log}"; [ "$1" = "${failStep ?? "-"}" ] && exit 3; exit 0`,
    );
    const r = run(["sh", join(root, "scripts/entrypoint.sh"), "bun", "src/index.ts"], root, {
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
    });
    return { ...r, calls: readFileSync(log, "utf8").trim().split("\n") };
  }

  test("migrates, seeds, then starts the bot, in that order", () => {
    const r = entrypoint();
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      "bun scripts/entrypoint-migrate.ts",
      "bun scripts/seed.ts",
      "bun src/index.ts",
    ]);
  });

  test("a failed migration stops the boot before the seeds and the bot", () => {
    const r = entrypoint("scripts/entrypoint-migrate.ts");
    expect(r.code).toBe(3);
    expect(r.calls).toEqual(["bun scripts/entrypoint-migrate.ts"]);
  });

  test("a failed seed stops the boot before the bot", () => {
    const r = entrypoint("scripts/seed.ts");
    expect(r.code).toBe(3);
    expect(r.calls).not.toContain("bun src/index.ts");
  });
});

const hasDocker = Bun.spawnSync(["docker", "compose", "version"]).exitCode === 0;

describe.skipIf(!hasDocker)("production compose profile", () => {
  function resolved() {
    const root = tmp();
    for (const f of ["docker-compose.yml", "docker-compose.prod.yml"]) {
      copyFileSync(join(repo, f), join(root, f));
    }
    writeFileSync(join(root, ".env"), "TELEGRAM_BOT_TOKEN=x\n");
    const r = run(
      [
        "docker",
        "compose",
        "-f",
        "docker-compose.yml",
        "-f",
        "docker-compose.prod.yml",
        "config",
        "--format",
        "json",
      ],
      root,
      { COMPOSE_PROJECT_NAME: "ec-test-config" },
    );
    expect(r.code).toBe(0);
    return JSON.parse(r.out) as {
      services: Record<
        string,
        {
          restart?: string;
          healthcheck?: unknown;
          logging?: { driver?: string; options?: Record<string, string> };
          ports?: { host_ip?: string }[];
          environment?: Record<string, string>;
        }
      >;
    };
  }

  test("every service restarts unless stopped, rotates its logs and has a healthcheck", () => {
    const { services } = resolved();
    expect(Object.keys(services).sort()).toEqual([
      "app",
      "backup",
      "postgres",
      "redis",
      "stt",
      "tts",
    ]);
    for (const [name, svc] of Object.entries(services)) {
      expect(svc.restart, name).toBe("unless-stopped");
      expect(svc.logging?.driver, name).toBe("json-file");
      expect(svc.logging?.options?.["max-size"], name).toBe("10m");
      if (name !== "backup") expect(svc.healthcheck, name).toBeDefined();
    }
  });

  test("published ports are loopback only and the bot long-polls", () => {
    const { services } = resolved();
    for (const [name, svc] of Object.entries(services)) {
      for (const p of svc.ports ?? []) expect(p.host_ip, name).toBe("127.0.0.1");
    }
    expect(services.app?.environment?.BOT_MODE).toBe("polling");
  });
});
