# EnglishCoach — architecture and product decisions

A Telegram bot that coaches English through LLM-driven "skills": grammar
quizzes, daily vocabulary with spaced repetition, morning/evening routines,
free conversation with corrections, a placement test and voice practice.
Backend only — there is no web frontend. Telegram is the whole UI.

This document records the decisions taken on 2026-10-26. Each GitHub issue
implements a part of it; when an issue and this file disagree, the issue is
newer and wins, and the issue's pull request updates this file.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Bun (TypeScript, strict) |
| Telegram | grammY (long polling in dev, webhook optional in prod) |
| HTTP | Hono — health, admin, future runner endpoints |
| Database | PostgreSQL 16 + Drizzle ORM / drizzle-kit migrations |
| Queue / scheduling / ephemeral state | Redis 7 + BullMQ |
| Validation | zod (env, LLM output, callback payloads) |
| SRS | FSRS via `ts-fsrs` |
| i18n | UI in `ru`, `en`, `uk`; explanations in the learner's chosen language |
| Lint / format | Biome |
| Tests | `bun test` |
| Deploy v1 | docker-compose (one host). Kubernetes/Helm is v2 |

## Ports (non-standard on purpose — the dev host already uses 5432, 6390, 8000, 9000)

| Service | Host port |
|---|---|
| API (Hono) | 18740 |
| PostgreSQL | 55433 |
| Redis | 56380 |

All are overridable via env; the defaults above live in `.env.example` and
`docker-compose.yml`.

## Access

Allowlist of Telegram user IDs. `ADMIN_TELEGRAM_IDS` in env are always
allowed and can `/allow <id>` / `/deny <id>`. Everyone else gets a polite
refusal and nothing is stored about them beyond the refusal log line.

## LLM providers (per user, chosen in Telegram settings)

One interface, several implementations:

| Provider | v1 | Notes |
|---|---|---|
| `server` | yes | owner's key from env; default for allowlisted users |
| `anthropic` (BYOK) | yes | user's own key + model |
| `openai` (BYOK) | yes | user's key, optional base URL — covers OpenRouter and any OpenAI-compatible router |
| `claude-code` | yes | server runs `claude -p --output-format json` with the skill as system prompt; uses the host's Claude subscription |
| `runner` | **v2** | user's own machine via a paired runner. The provider interface must not preclude it |

User secrets (API keys) are encrypted at rest with AES-256-GCM under
`MASTER_KEY` from env, never logged, and the Telegram message that carried a
key is deleted as soon as it is read.

**The LLM never computes state.** Skills return JSON validated by zod; the
server applies FSRS, scores, streaks and persistence.

## Skills

A skill is a prompt file: `skills/<id>/SKILL.md` with YAML frontmatter
(`id`, `title`, `kind`, `output` — the name of a zod schema registered in
code, `model_hint`) and a markdown body that is the system prompt, with
`{{placeholders}}` for learner context (level, native/explanation language,
weak spots, due items). Adding or editing a skill file changes behaviour
without code changes, as long as its `output` schema exists.

References the base set is modelled on:

- **m98/fluent** — one item at a time; priority = due today → recent
  mistakes → new high-frequency words; target 60–70 % success and adapt
  difficulty; error *patterns* are SRS items too, not only words; feedback
  tagged with severity (critical/moderate/minor) and category.
- **tianmind-studio/english-coach** — passive correction block after a
  normal reply: `~~orig~~ → **fixed**` + category (Spelling, Grammar, Word
  Choice, Punctuation, Expression) + one-line why; at most 5 corrections;
  one rotating learning tip (phrase / grammar tip / level-up / common
  mistake for the learner's native language).

## Vocabulary

A CEFR-levelled frequency dictionary is seeded into the database (licence
must allow redistribution). The LLM only *enriches* a card (translation into
the learner's language, IPA, 2 examples, collocations) and generates
exercises; it does not pick the words. Learners may also add their own words
by message. Daily new-word count is a setting.

## Telegram UX rules

1. **The hub.** Exactly one menu message per chat with inline buttons:
   Learn words · Review · Grammar · Talk · Progress · Settings. It is
   **pinned**, and after every session it is **re-sent at the bottom** (old
   one deleted, new one pinned). Sub-screens (settings, progress) open by
   *editing* the hub message, never by sending new ones.
2. **Sessions clean up after themselves.** Every message of a session —
   the bot's and the learner's — is tracked; when the session ends
   (finished, cancelled, or timed out) they are all deleted and a one-line
   summary is folded into the hub. Telegram allows deleting messages up to
   48 h old; sessions longer than that are not a v1 concern.
3. One question per message; answers via buttons where the answer space is
   closed, free text where it is not.

## Daily routine

Per-user timezone and two times (default 08:30 / 20:00). Morning: due
reviews + today's new words. Evening: grammar quiz + review of the day's
mistakes. Streak counts days where the daily goal was met; a reminder is sent
if the evening slot passes untouched.

## Out of scope for v1 (filed, not ready)

- the `runner` provider (pair a user's machine; bot dispatches prompts to it)
- Kubernetes / Helm deployment
- any web frontend
