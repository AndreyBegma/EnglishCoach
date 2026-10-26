# EnglishCoach

Telegram bot that coaches English with LLM-driven skills: grammar quizzes,
daily vocabulary with FSRS spaced repetition, morning/evening routines,
conversation with corrections, placement test and voice practice.

Bring your own Anthropic / OpenAI / OpenRouter key, use the server key, or
run through Claude Code on the server.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run locally

Requires [Bun](https://bun.sh) and Docker.

```sh
bun install
cp .env.example .env               # set TELEGRAM_BOT_TOKEN, and MASTER_KEY=$(openssl rand -base64 32)
docker compose up -d postgres redis   # PostgreSQL on :55433, Redis on :56380
bun run dev                        # API on http://localhost:18740, bot on long polling
curl http://localhost:18740/health # {"ok":true,"db":true,"redis":true}
```

A missing or invalid variable stops the process with one line naming it.

To run everything in containers instead: `docker compose up -d --build`.

## Scripts

| Script | What it does |
|---|---|
| `bun run dev` | Start with file watching |
| `bun run start` | Start once |
| `bun run lint` | Biome lint + format check (`bun run format` fixes) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun test` | Unit tests; the Postgres/Redis probe tests run only when `DATABASE_URL` / `REDIS_URL` are set (Bun loads `.env` automatically) |
| `bun run db:generate` | Generate a migration from `src/db/schema.ts` into `drizzle/` |
| `bun run db:migrate` | Apply migrations to `DATABASE_URL` |

## Layout

```
src/index.ts        boots HTTP + bot, graceful shutdown
src/config/env.ts   zod-validated environment, fails fast
src/http/           Hono app (GET /health)
src/bot/            grammY bot and i18n (Fluent, locales/*.ftl)
src/db/             Drizzle client and schema
src/redis.ts        Redis client
src/log.ts          JSON logger that redacts *key* / *token* / *secret* fields
locales/            ru, en, uk translations — every key in all three
```
