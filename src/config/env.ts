import { z } from "zod";

/** Treats an empty or whitespace-only value the same as an unset one. */
function unsetIfBlank<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema,
  );
}

const requiredString = z.string({ error: "is required" }).trim();
const url = requiredString.pipe(z.url({ error: "must be a URL" }));

const masterKey = requiredString.refine(
  (value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32,
  "must be 32 bytes encoded as base64 (generate with `openssl rand -base64 32`)",
);

const telegramIds = z
  .string()
  .default("")
  .transform((value, ctx) => {
    const ids = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (ids.some((id) => !/^\d+$/.test(id))) {
      ctx.addIssue({ code: "custom", message: "must be a comma-separated list of numeric IDs" });
      return z.NEVER;
    }
    return ids.map(Number);
  });

const flag = z
  .enum(["true", "false", "1", "0"], { error: "must be true or false" })
  .default("false")
  .transform((value) => value === "true" || value === "1");

const envSchema = z
  .object({
    NODE_ENV: unsetIfBlank(z.enum(["development", "production", "test"]).default("development")),
    LOG_LEVEL: unsetIfBlank(z.enum(["debug", "info", "warn", "error"]).default("info")),
    TELEGRAM_BOT_TOKEN: unsetIfBlank(requiredString),
    DATABASE_URL: unsetIfBlank(url),
    REDIS_URL: unsetIfBlank(url),
    HTTP_PORT: unsetIfBlank(z.coerce.number().int().min(1).max(65535).default(18740)),
    MASTER_KEY: unsetIfBlank(masterKey),
    ADMIN_TELEGRAM_IDS: unsetIfBlank(telegramIds),
    SERVER_LLM_PROVIDER: unsetIfBlank(
      z
        .enum(["anthropic", "openai", "claude-code"], {
          error: "must be one of anthropic, openai, claude-code",
        })
        .optional(),
    ),
    SERVER_ANTHROPIC_API_KEY: unsetIfBlank(requiredString.optional()),
    SERVER_OPENAI_API_KEY: unsetIfBlank(requiredString.optional()),
    SERVER_OPENAI_BASE_URL: unsetIfBlank(url.optional()),
    SERVER_DEFAULT_MODEL: unsetIfBlank(requiredString.optional()),
    CLAUDE_BIN: unsetIfBlank(requiredString.default("claude")),
    BOT_MODE: unsetIfBlank(
      z.enum(["polling", "webhook"], { error: "must be polling or webhook" }).default("polling"),
    ),
    // Path segment and secret token of the webhook; only used when BOT_MODE=webhook.
    TELEGRAM_WEBHOOK_SECRET: unsetIfBlank(
      requiredString
        .regex(/^[A-Za-z0-9_-]{16,256}$/, "must be 16-256 characters of A-Z, a-z, 0-9, _ or -")
        .optional(),
    ),
    // Public base URL Telegram calls in webhook mode, e.g. https://coach.example.com
    PUBLIC_URL: unsetIfBlank(url.optional()),
    SESSION_TIMEOUT_MINUTES: unsetIfBlank(z.coerce.number().int().min(1).max(1440).default(20)),
    ENABLE_DEMO_SESSION: unsetIfBlank(flag),
  })
  .superRefine((env, ctx) => {
    if (env.BOT_MODE !== "webhook") return;
    for (const key of ["TELEGRAM_WEBHOOK_SECRET", "PUBLIC_URL"] as const) {
      if (!env[key])
        ctx.addIssue({ code: "custom", path: [key], message: "is required in webhook mode" });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Raised when the environment is invalid. The message names variables, never their values. */
export class EnvError extends Error {
  override name = "EnvError";
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "environment"} ${issue.message}`,
  );
  throw new EnvError(problems.join("; "));
}
