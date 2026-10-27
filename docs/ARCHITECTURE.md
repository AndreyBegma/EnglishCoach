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
| Production | `docker-compose.prod.yml` on top of the base file, driven by `scripts/deploy.sh`; the app image boots through `scripts/entrypoint.sh` (migrate, seed, start) — see README "Deploy" |
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

## Level model

`skill_levels` holds one row per learner and skill (grammar, vocabulary,
reading, listening, writing, speaking): a continuous `rating` on the CEFR scale
(A1.0 = 0, B1.6 = 2.6, C2.9 = 5.9 — the band index plus the tenth of the band
covered), its `uncertainty` (a standard deviation in the same units) and the
`evidence` (graded items) behind it. `src/levels/` owns it; nothing else writes
there.

**Updates.** Every grader calls `recordGradedItem(db, userId, skill,
difficulty, score, { expected })` once per graded item (through the helpers in
`src/levels/items.ts`): `score` 0..1 (partial credit in between), `difficulty`
a CEFR band (its centre), a rating, or null for an item pitched at the
learner's own level. The model is IRT-lite: success chance
`logistic((rating − difficulty) / 0.75)`, a Kalman-style step (variance shrinks
by the item's information, the rating moves by the surprise times the
variance), uncertainty floored at 0.2 and widened slowly over idle days.
`expected` is what a learner of exactly the item's level scores on such items
by design (quiz 0.65, FSRS review 0.9, conversation turn 0.75, placement 0.5),
so a by-design success rate does not read as a higher level. It returns the
new level plus the rating before the item and the item's level on the same
scale, which is what XP is computed against.

| Grader | Skill | Difficulty | Score |
|---|---|---|---|
| Grammar quiz | grammar | syllabus topic's level (`grammarItemDifficulty`), else the quiz's estimate | correct 1 · partial 0.5 · wrong 0 |
| Vocabulary card rating | vocabulary | the word's CEFR level; own words at the learner's level; grammar-pattern cards do not count | again 0 · hard 0.5 · good/easy 1 |
| Talk turn (≥ 5 words) | writing | the learner's level | 1 − 0.5·critical − 0.25·moderate − 0.1·minor |
| Placement test | the item's skill | the item's level | 1 / 0 |

**Seeding.** The placement result seeds all six skills at its band centre
(uncertainty 0.6), then replays each graded item into its own skill. A level
the learner chooses (onboarding, Settings) re-seeds at uncertainty 0.8.

**Overall level and the cache.** The overall level is the mean of the skill
ratings weighted by 1/uncertainty² (practised skills dominate).
`user_settings.cefr_level` is a cache of its band, rewritten after each graded
item; it stays null until the learner has a level, which is what sends them
through onboarding. A learner who has the cache but no rows reads as seeded at
that band and is backfilled on their first graded item.

Progress shows the overall level as a decimal (B1.6) and each practised skill;
Settings shows the overall decimal; skill prompts get the overall band.

## XP and the profile level

`xp_events` is the ledger (one row per award: `source`, `amount`, `meta`,
never updated); `user_xp` caches the total and the profile level. Only
`awardXp` (`src/gamification/awards.ts`) writes them, in one transaction, and
an amount of 0 writes nothing. The rules are pure, in
`src/gamification/xp.ts`; the graders do not call them — the level helpers in
`src/levels/items.ts` do, right after the level update, and a failed award is
logged and never fails the grader.

| Source | When | XP |
|---|---|---|
| `grammar_item` | a graded quiz answer | 10 × score × multiplier |
| `word_learned` | the first passing rating of a card still New or Learning, once per card | 6 × score × multiplier |
| `review` | any other passing card rating (Again earns nothing) | 4 × score × multiplier |
| `talk_turn` | a talk turn long enough to count | 8 × score (at the learner's level) |
| `topic_mastered` | a syllabus topic's first mastery (`topic.mastered` with `first`), once per topic | 50 × multiplier |
| `daily_goal` | the day's goal was just met (`markGoalMet` flipped it) | 30 |
| `streak` | the same moment, from day 2 of a streak | 5 × streak days, at most 50 |
| `achievement` | an achievement was just unlocked, once per achievement | the entry's `xp_reward` |

**Difficulty multiplier and anti-farming.** With `gap` = item level − the
learner's rating in that skill before the item: 1 + 0.5·min(gap, 1) above the
learner (×1.5 a band up), 1 within half a band below, and below that it halves
every half band — two bands below is worth an eighth, and XP is rounded down,
so items far below the learner's level earn 0 and never count toward mastery.

**Level curve.** Level 1 at 0 XP; going from level n to n + 1 costs
`round(100 × 1.15^(n − 1))` (100, 115, 132, …).

**`xp.awarded`.** After each award `xpEvents` (`src/gamification/events.ts`, a
process singleton, the same contract as `settings.changed`) emits the award
with the new total, level and previous level; achievements and level-up
notices subscribe there. A failing listener is logged and never fails the
award.

**Profile screen.** Hub → 👤 Profile edits the hub: profile level, XP bar to
the next level, streak, the overall CEFR decimal and every skill's (`~` marks a
skill with no graded items yet), the last three achievements and all-time
totals. Its button rides the progress callback codec (`<v>:p:u`).

## Achievements

**Catalogue.** `data/achievements/*.yaml`, declarative. A file holds *series* —
one metric, ascending thresholds grouped by tier (bronze, silver, gold,
platinum, legend), an emoji, and a title and description in every UI locale
with `{n}` for the threshold (phrased "Words learned: {n}" so Russian and
Ukrainian need no plural forms; `format: cefr` shows a band index as its band)
— and standalone *entries* (the secret ones). A series expands into one entry
per step, `<series>_<threshold>`; one "Mastered: <topic>" entry per syllabus
topic (`topic_<id>`) is generated from the syllabus. Every entry has `id`,
`category`, `metric`, `threshold`, `tier`, `emoji`, `xp_reward` (by tier unless
given), `secret`, and its texts. `src/gamification/achievements/catalogue.ts`
validates it with zod (known metric, every locale, unique ids, thresholds rising
within a series) and the bot loads it at boot, so a bad file fails boot.

**Metrics and events.** Counters live in `achievement_progress` (one row per
learner and metric); `src/gamification/achievements/metrics.ts` lists every
metric and the event that moves it. Events travel on `domainEvents`
(`src/events/domain-events.ts`, the `settings.changed` contract): `xp.awarded`
(XP total, profile level, goal days, day streak, Talk turns),
`grammar.answered` and `card.rated` (from `src/gamification/awards.ts`, every
graded answer, wrong ones included), `card.learned`, `session.ended` (bridged
from `SessionManager.onEnded`: sessions per kind, perfect sessions, learner-local
morning / night / weekend, seasonal date windows) and `talk.correction_fixed`
(subscribed by name, not emitted yet — the Talk card that tracks fixed
corrections will). Per-topic entries listen to `topic.mastered` on
`topicEvents` (`src/grammar/events.ts`); a topic counts once, re-masteries
included. Each skill's CEFR milestone reads
the level model after a graded item. A perfect session is a finished one with at
least five graded items and no miss.

**Evaluator.** `AchievementEngine.record` applies the counter updates and, in the
same transaction, inserts every entry whose counter reached its threshold into
`user_achievements` with `on conflict do nothing`. Only the rows that insert
actually created award their XP (`source = achievement`), after the commit — so
a replayed or concurrent event never unlocks or pays twice. A failure is logged
and never fails the grader or the session that raised the event.

**Notification and screens.** An unlock sends no message of its own: the next
render of the hub's main screen carries one line ("🏆 Unlocked: …", three by
name and "+N"), and the unlocks are marked shown (`notified_at`) once that hub
is on screen. Profile → 🏆 Achievements is a paginated hub screen (`<v>:p:a:<page>`):
unlocked count, grammar topics mastered, then per series the latest unlocked step
and a progress bar to the next one; secret entries show only once found.

## Grammar syllabus

One topic map from A1 to C2 in `data/grammar/syllabus/*.yaml` (one file per
band), keyed by topic id. The ids are the owner's course ids: `g001`–`g085`
are the topics of `seed/grammar` and never change or move band; new topics
take the next free number. The owner's rule text and exercises stay in the
seed; the syllabus adds per topic a fine `level` (`B1.4`: band, then step
1-9), a `title` in every UI locale (`en`, `ru`, `uk` — the picker shows it,
there are no locale keys per topic), `prerequisites`, `contrast_with`,
`examples`, `interference` (typical Russian/Ukrainian speaker mistakes, each
with its cause) and `exercise_types` (grammar-quiz item types).
`src/grammar/syllabus.ts` validates it with zod: every referenced id exists,
no topic refers to itself, no prerequisite sits above its topic's level, the
prerequisite graph is acyclic, every title locale is present. It is loaded
when the grammar module loads, so an invalid file fails boot. The grammar
picker offers the learner's grammar band (B1 without a level); a button
carries the topic id, and the quiz gets the topic's English title, its
syllabus entry and only its exercise types. `mistakes.topic_id` maps a
pattern to a syllabus topic: grammar-quiz names the item's topic (forced to
the picked one; otherwise chosen from the learner's band and its neighbours),
grammar-check may name another for the main error, and the server keeps only
ids that exist in the syllabus. A later occurrence without an id keeps the
stored one.

## Topic mastery

`topic_progress` holds one row per learner and syllabus topic: `status`
(`not_started` ⬜ · `learning` 🔴 · `shaky` 🟡 · `mastered` ✅), the rolling
window of the last 8 graded items (`recent_items`, with `accuracy_by_type`
derived from it), `transfer_evidence`, the confirmation clock
(`criteria_met_at`, `confirmed_at`), the FSRS card of a mastered topic
(`fsrs`, `review_due`), the scores of a running check (`check_scores`) and
`method_history` (for the adaptive-methods card). The rules are pure, in
`src/grammar/mastery.ts`; only `recordTopicItem` and `recordTopicUses`
(`src/grammar/progress.ts`) write the table, under a row lock.

- **Items.** Every graded grammar-quiz answer with a validated `topic_id`
  feeds its topic (`recordGrammarItem`, after `recordGradedItem`), with the
  item type and its score. The first one moves `not_started` → `learning`.
- **Transfer.** The `conversation` skill gets `syllabus_topics` around the
  learner's grammar band and returns `topic_uses`, the ids its message used
  correctly; a counted Talk turn adds one piece of evidence per known id.
- **Mastery rule** (`masteryRule`, one function — C-58 replaces it): the
  window is full, its mean score ≥ 85 % and it spans ≥ 2 exercise types; that
  still holds on an item ≥ 3 days after it first held; and ≥ 1 transfer
  evidence. A window that breaks before the confirmation restarts the clock.
- **Shaky.** A mastered topic whose window falls below 85 % becomes `shaky`
  and has to earn the confirmation again.
- **FSRS.** A topic that becomes mastered is rated Good on its card (a new one
  the first time; ts-fsrs without short-term steps, so intervals are days).
  When it is due, its next 3 items are the check: a wrong one rates Again and
  sends the topic back to `learning`; three passes rate Good (Hard if any was
  partial).
- **`topic.mastered`.** `topicEvents` (`src/grammar/events.ts`, the same
  contract as `xp.awarded`) emits `{ userId, topicId, at, first }` on every
  mastery; `first` is the topic's first ever. The level helpers pay
  `topic_mastered` XP on `first`, at most once per topic.
- **Next topic** (`nextTopic`): due reviews (most overdue first) → shaky
  topics → not-started topics at the learner's grammar band whose
  prerequisites are mastered or below that band → topics at the band still
  being learned. The grammar band is the grammar skill's level, else the
  overall one, else B1. The grammar picker leads with it and marks every
  topic with its status.

## Telegram UX rules

1. **The hub.** Exactly one menu message per chat with inline buttons:
   Learn words · Review · Grammar · Talk · Progress · Profile · Settings. It is
   **pinned**, and after every session it is **re-sent at the bottom** (old
   one deleted, new one pinned). The "… pinned a message" notice each pin
   adds is deleted from its own update (`src/hub/pin-notices.ts`): a
   private-chat message with `pinned_message` sent by the bot. The Bot API
   does not promise that update in private chats and cannot read a message
   by ID, so when it is not delivered the notice stays; the bot never deletes
   a guessed ID. Sub-screens (settings, progress, profile) open by
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
if the evening slot passes untouched. The session that meets a day's goal
earns the goal and streak XP for it.

## Out of scope for v1 (filed, not ready)

- the `runner` provider (pair a user's machine; bot dispatches prompts to it)
- Kubernetes / Helm deployment
- any web frontend
