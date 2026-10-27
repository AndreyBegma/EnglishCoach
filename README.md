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

Only Telegram IDs in `ADMIN_TELEGRAM_IDS` can use the bot at first; they add others with
`/allow <id>` (and `/deny <id>`, `/users`). Send `/start` or `/menu` to get the pinned hub.
Set `ENABLE_DEMO_SESSION=true` and send `/demo` to see a session clean up after itself.

To run everything in containers instead: `docker compose up -d --build`.

## Scripts

| Script | What it does |
|---|---|
| `bun run dev` | Start with file watching |
| `bun run start` | Start once |
| `bun run lint` | Biome lint + format check (`bun run format` fixes) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun test` | Unit tests; the Postgres/Redis integration tests run only when `DATABASE_URL` (or `DATABASE_URL_TEST`) / `REDIS_URL` are set (Bun loads `.env` automatically). DB tests create and drop a throwaway `coach_test_*` database per file on that server |
| `LLM_LIVE_TESTS=1 bun test test/skills/live.test.ts` | Opt-in smoke test against real models: one skill call per provider whose credentials are set — Anthropic once per tier on its default model — (`SERVER_ANTHROPIC_API_KEY`, `SERVER_OPENAI_API_KEY` [+ `SERVER_OPENAI_BASE_URL`, `LLM_LIVE_OPENAI_MODEL`], or a `claude` binary). Costs money; never runs in CI |
| `bun run db:generate` | Generate a migration from `src/db/schema/` into `drizzle/` |
| `bun run db:migrate` | Apply migrations to `DATABASE_URL` |
| `bun run db:seed:words` | Seed the CEFR frequency dictionary (`data/words/`), idempotent |
| `bun run db:import:owner-words <path>` | Import the owner's curated word list (.xlsx) over the dictionary, idempotent — see below |

## The owner's word list

The owner's curated list (Oxford 5000 levels, dictionary example sentences) is **not
redistributable and never goes into git** — neither the workbook nor anything extracted from it.
Keep it in `data/private/` (git-ignored) or anywhere outside the repository, and import it into
the database:

```sh
bun run db:seed:words                                   # the dictionary first
bun run db:import:owner-words data/private/owner-words.xlsx
```

The importer reads the sheets `0 Проверка A1–A2`, `1 B1` … `6 Редкие III` (day-header rows skipped)
and `Убрано` (lemmas never offered). The owner's level, part of speech, IPA, Russian translation,
example and topic win over the dictionary's; its frequency rank stays. Learn words then follows the
owner's order at the learner's level. Re-running it, or re-seeding the dictionary afterwards,
changes nothing. The phrasal-verb and grammar sheets are not imported yet.

With `SERVER_LLM_PROVIDER` set, a BullMQ job keeps the next `WORD_PREFETCH_DAYS` × words-per-day
new words of every learner enriched ahead of time (after each Learn words session, on a level /
language / daily-goal change and nightly), and a low-rate backfill works through the rest of the
list (`WORD_BACKFILL_EVERY_MINUTES`, `WORD_BACKFILL_WORDS`). Cards then read the shared cache; a
miss falls back to inline enrichment and logs `metric: vocab.enrich.cache_miss`.

## Layout

```
src/index.ts        boots HTTP + bot, graceful shutdown
src/config/env.ts   zod-validated environment, fails fast
src/http/           Hono app (GET /health, POST /tg/<secret> in webhook mode)
src/bot/            grammY bot: allowlist + admin commands, i18n (Fluent), callback data, Redis flow state
src/hub/            the pinned hub (main menu) and its sub-screens
src/sessions/       learning sessions: message tracking, cleanup, kind handlers (ctx.learning)
src/queue/          BullMQ jobs (session inactivity timeout, routine, word enrichment)
src/words/          dictionary seed, owner list importer, word picker, enrichment cache filler
src/db/             Drizzle client, schema/ (one file per area), repositories/, FSRS mappers
drizzle/            generated SQL migrations
src/redis.ts        Redis client
src/log.ts          JSON logger that redacts *key* / *token* / *secret* fields
locales/            ru, en, uk translations — every key in all three
src/llm/            LLM providers (server, anthropic, openai, claude-code) and resolveProvider
src/skills/         skill engine: registry, prompt rendering, learner context, SkillRunner
skills/             one SKILL.md prompt per skill (see "Skills" below)
src/crypto/         AES-256-GCM for user API keys under MASTER_KEY
```

## LLM providers

`resolveProvider(deps, userId)` returns the user's active provider, or `server` (configured by
`SERVER_LLM_PROVIDER` and its key in `.env`) when they have none. Every provider takes a zod
schema and returns only data that passed it: an invalid answer gets one repair turn, then an
`LlmOutputError`. Model choice: the user's model, else the caller's, else the backend's `fast` /
`smart` default in `src/llm/models.ts`. User keys are stored encrypted and shown back only as a
masked hint (`sk-…a1b2`).

## Voice

With Settings → Voice on, a voice message (up to 60 s) in Talk, Grammar or a typed Review answer
is transcribed (OpenAI-compatible `audio/transcriptions`), shown as a tracked message and handled
as if typed. Word cards get a 🔊 button that sends the pronunciation (`audio/speech`) as a voice
note. The key is the user's own OpenAI-compatible key, else `SERVER_OPENAI_API_KEY`; with neither,
the bot says voice needs a key and the session carries on. Generated audio is cached per lemma and
voice under `data/tts/` (override with `TTS_CACHE_DIR`; mount it as a volume in production).

## Skills

A skill is `skills/<id>/SKILL.md`: YAML frontmatter plus the system prompt. `loadSkillRegistry()`
validates every file at boot and fails naming each bad one.

```yaml
---
id: grammar-quiz          # = directory name
title: Grammar quiz item
kind: quiz                # quiz | check | enrich | exercise | placement | conversation | plan
input: GrammarQuizInput   # zod schema for the call's vars, in src/skills/schemas.ts
output: GrammarQuizOutput # zod schema for the model's answer, in src/skills/schemas.ts
model_hint: smart         # fast | smart (the user's chosen model still wins)
temperature: 0.8          # optional, 0-1; sent only to models that accept it (see src/llm/models.ts)
max_tokens: 1500          # optional
---
```

The body may use only `{{level}}`, `{{explain_lang}}`, `{{ui_lang}}`, `{{native_lang}}`,
`{{native_hints}}` and `{{target_accuracy}}` — server-owned values. Learner text never goes into
the system prompt: `SkillRunner.runSkill(userId, skillId, vars, history?)` sends the learner's
context (interests, weak spots) and the validated `vars` as tagged JSON in the last user message.
Editing a prompt changes behaviour without code changes; a new schema needs code in
`src/skills/schemas.ts`.
