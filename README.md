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
| `bun test` | Unit tests; the Postgres/Redis integration tests run only when `DATABASE_URL` (or `DATABASE_URL_TEST`) / `REDIS_URL` are set (Bun loads `.env` automatically). DB tests create and drop a throwaway `coach_test_*` database per file on that server |
| `bun run db:generate` | Generate a migration from `src/db/schema/` into `drizzle/` |
| `bun run db:migrate` | Apply migrations to `DATABASE_URL` |
| `bun run db:seed:words` | Seed the CEFR frequency dictionary (`data/words/`), idempotent |

## Layout

```
src/index.ts        boots HTTP + bot, graceful shutdown
src/config/env.ts   zod-validated environment, fails fast
src/http/           Hono app (GET /health)
src/bot/            grammY bot and i18n (Fluent, locales/*.ftl)
src/db/             Drizzle client, schema/ (one file per area), repositories/, FSRS mappers
drizzle/            generated SQL migrations
src/redis.ts        Redis client
src/log.ts          JSON logger that redacts *key* / *token* / *secret* fields
locales/            ru, en, uk translations — every key in all three
src/llm/            LLM providers (server, anthropic, openai, claude-code) and resolveProvider
src/crypto/         AES-256-GCM for user API keys under MASTER_KEY
```

## LLM providers

`resolveProvider(deps, userId)` returns the user's active provider, or `server` (configured by
`SERVER_LLM_PROVIDER` and its key in `.env`) when they have none. Every provider takes a zod
schema and returns only data that passed it: an invalid answer gets one repair turn, then an
`LlmOutputError`. Model choice: the user's model, else the caller's, else the backend's `fast` /
`smart` default in `src/llm/models.ts`. User keys are stored encrypted and shown back only as a
masked hint (`sk-…a1b2`).
