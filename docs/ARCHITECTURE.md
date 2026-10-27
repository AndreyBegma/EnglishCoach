# EnglishCoach — architecture and product decisions

A Telegram bot that coaches English through LLM-driven "skills": grammar
quizzes, daily vocabulary with spaced repetition, morning/evening routines,
free conversation with corrections, a placement test and voice practice.
Backend only — there is no web frontend. Telegram is the whole UI.

This document records the decisions taken on 2026-10-26. Each GitHub issue
implements a part of it; when an issue and this file disagree, the issue is
newer and wins, and the issue's pull request updates this file.

Product decisions for v2 (what the app is meant to do): [PRODUCT.md](PRODUCT.md).

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
| Backups | `backup` compose service: daily `pg_dump -Fc` to `./backups`, 7 daily / 4 weekly / 3 monthly rotation, weekly restore check (`scripts/backup*.sh`, `scripts/restore*.sh`) |

## Ports (non-standard on purpose — the dev host already uses 5432, 6390, 8000, 9000)

| Service | Host port |
|---|---|
| API (Hono) | 18740 |
| PostgreSQL | 55433 |
| Redis | 56380 |
| TTS (Kokoro-FastAPI) | 18880 |
| STT (faster-whisper) | 18890 |

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
(`id`, `title`, `kind`, `input` and `output` — names of zod schemas in
`src/skills/schemas.ts`, `model_hint` `fast|smart`, optional `temperature`
and `max_tokens`) and a markdown body that is the system prompt. Adding or
editing a skill file changes behaviour without code changes, as long as its
schemas exist. `loadSkillRegistry()` validates every file at boot (bad
frontmatter, unknown schema, unknown placeholder, id ≠ directory, a missing
base skill) and fails naming each bad file.

**Prompt-injection hygiene.** The system prompt may only contain
server-owned placeholders: `{{level}}`, `{{explain_lang}}`, `{{ui_lang}}`,
`{{native_lang}}`, `{{native_hints}}` (curated per-language notes in code)
and `{{target_accuracy}}`. Everything that is or derives from learner text —
interests, weak-spot patterns from `mistakes`, card text, answers, chat
messages — plus the call's validated `vars` travels as tagged JSON
(`<learner_context>`, `<task>`) in the last user message, and the prompt
tells the model to treat it as data.

**Native language.** There is no setting for it: `explain_lang` if it is
`ru`/`uk`, else `ui_lang` if it is, else unknown (generic tips).

**Running a skill.** `new SkillRunner({ registry, provider, learner })
.runSkill(userId, skillId, vars, history?)` validates `vars`, loads the
learner context (settings + top 5 `mistakes`), renders the prompt and calls
the user's provider with the skill's output schema, tier and temperature.
For the eight base skills (`BASE_SKILLS`) vars and output are typed.

**Base set.** `grammar-quiz`, `grammar-check`, `vocab-enrich`,
`vocab-exercise`, `vocab-check`, `placement-test` (multiple choice only, so
the server grades; at most 15 items), `conversation` (reply + ≤ 5
structured corrections + one tip of a server-rotated kind; the bot renders
the corrections block through i18n) and `routine-plan`. Quiz and exercise
skills take `recent_accuracy` and aim at 60–70 % success. Graders return a
*suggestion* (verdict, FSRS rating, running CEFR estimate); the server
decides. Correction categories are the `mistake_category` enum, so they map
straight onto `mistakes` rows.

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

**The owner's list.** A curated workbook (not redistributable, kept out of
git) is imported over the dictionary with `bun run db:import:owner-words`.
Its rows (`source = owner_list`) carry the owner's level (the rare bands
count as C2), fields and curriculum position; its `Убрано` sheet fills
`excluded_lemmas`. The picker offers, at the learner's level, owner words in
curriculum order first, then dictionary words by frequency, skipping known,
removed and duplicate lemmas.

**Enrichment cache.** `word_enrichments` holds one card back per word and
explanation language, shared by all learners (so it carries no learner
context). A BullMQ job fills it ahead of time with the server provider and the
`vocab-enrich-batch` skill — the next 3 days of each learner's words, plus a
low-rate backfill — and the curated fields override the model's. Learn words
reads the cache; a miss falls back to inline `vocab-enrich` with the learner's
provider and is logged as a metric.

**Word pictures.** The enrichment decides whether a word is imageable: an
`image_query` (English, from the first example's sense) or, for an abstract
word, `null` and an `emoji` shown before the word. `WordImages`
(`src/images/`) searches Pexels, then Unsplash (`PEXELS_API_KEY`,
`UNSPLASH_ACCESS_KEY`, both optional — with neither, cards stay text), once per
dictionary word, and stores the choice in `word_images` (URL, size, source,
author and photo page for the credit, query, result index); a search that
finds nothing is stored too. The prefetch job fetches pictures of upcoming
words; backfill does not (the APIs' hourly limits). The new-word card is then
one photo whose caption holds the word, IPA, translation, the first example
(cut first to fit 1024 characters) and "📷 Author / Source" links; "🔄 Another
picture" moves the word to the next result, for every learner, and edits the
photo in place. Unsplash's download endpoint is called when one of its photos
is chosen. Any picture failure shows the text card; errors are logged with
the source and status only. A learner's own words have no picture.

**Word voices.** `Tts` (`src/voice/tts.ts`) voices a text once per engine and voice, uploads it
to the storage chat (`TTS_STORAGE_CHAT_ID`) and stores the `file_id` in `tts_audio`; a play is
then `sendVoice(file_id)`. The new-word card (text or photo) and review feedback on a word show
🔊 (the word) and "🔊 Example" (its first example) only when `tts.canPlay` says the tap can work:
voiced before, or an engine can voice it for that learner now. Every play uses the learner's
`english_variant`. A 🔊 tap takes the session lock and must match the card on screen (busy →
"wait", stale → "already answered"); it leaves the card's keyboard alone, and its voice note is
deleted with the step. The prefetch job prewarms upcoming words and examples; the voice backfill
(`src/voice/backfill.ts`, its own BullMQ queue, Kokoro only — background work never spends a
paid key) voices the whole owner's list a slice at a time and keeps one pinned status message in
the storage chat (`tts_status_board`), edited in place at most once a minute, re-sent and
re-pinned when it is gone; `pinNoticeCleanup` deletes the pin notice there too.

## Telegram UX rules

1. **The hub.** Exactly one menu message per chat with inline buttons:
   Learn words · Review · Grammar · Talk · Progress · Settings. It is
   **pinned**, and after every session it is **re-sent at the bottom** (old
   one deleted, new one pinned). The "… pinned a message" notice each pin
   adds is deleted from its own update (`src/hub/pin-notices.ts`): a
   private-chat message with `pinned_message` sent by the bot. The Bot API
   does not promise that update in private chats and cannot read a message
   by ID, so when it is not delivered the notice stays; the bot never deletes
   a guessed ID. Sub-screens (settings, progress) open by
   *editing* the hub message, never by sending new ones.
2. **One window per session.** While a session runs, the chat holds the hub
   and one session window; nothing else lives longer than a few seconds.
   The helper is `SessionWindow` (`src/sessions/window.ts`), on every
   handle as `ctx.learning.window`.
   - Every step (card → exercise → result → next card) is `window.show`: an
     edit of the same message, keyboard included, so no old buttons remain to
     tap. The previous step's result is the first line of the next screen,
     never a message of its own.
   - Telegram cannot turn text into a photo: a step with another media type
     sends the new window, then deletes the old one. Photo → photo is
     `editMessageMedia`.
   - Messages tied to a step (🔊 voice notes, added with `handle.track`) are
     deleted when the next step shows.
   - The learner's messages (typed answers, a word to add, voice answers) are
     deleted as soon as the session kind's `onMessage` has read them. A kind
     whose messages are its content (`keepsLearnerMessages`: Talk) prunes them
     itself: Talk keeps the latest exchange and deletes older ones.
   - Hints and warnings ("use the buttons", validation errors) are a callback
     toast where there is a callback, otherwise `window.flashNote`: a tracked
     note that deletes itself after ~5 s. A session shows at most one note.
   - **One answer at a time.** Every answer, choice and rating button goes
     through `acceptAnswer` (`src/sessions/answer.ts`). It holds the session's
     lock (`SessionLocks`, Redis `lock:session:<id>`, released in `finally`,
     150 s TTL) while the answer is graded and the next item prepared. A tap
     meanwhile gets a "wait" toast and is dropped, never queued; a tap whose
     item is no longer on screen gets "already answered" — buttons carry the
     item number or card id, checked under the lock. An accepted tap is
     acknowledged at once: a toast, the message marked with the choice and a
     "⏳ preparing" line with its keyboard removed, and the `typing` action
     until the work ends. Typed answers take the same lock in the session
     middleware; one sent while it is held (or, under polling, dated inside
     its last hold) gets a wait note and is deleted.
3. **Sessions clean up after themselves.** Every message of a session —
   the bot's and the learner's — is tracked; when the session ends
   (finished, cancelled, or timed out) they are all deleted (the window
   too) and a one-line summary is folded into the hub. Telegram allows
   deleting messages up to 48 h old; sessions longer than that are not a v1
   concern.
4. One question per screen; answers via buttons where the answer space is
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
