# EnglishCoach — v2 product decisions

Decisions agreed with the owner on 2026-10-26. Every v2 card and issue points
here. `docs/ARCHITECTURE.md` holds the stack, ports and provider model; this
file holds what the product is meant to do. When an issue and this file
disagree, the newer issue wins and its pull request updates this file.

## Learners

- The learners are the owner plus a few close people (allowlist).
- Everything is individual: goals, time budget and level are per user, and the
  app adapts to each of them.

## Level model

- A CEFR level per skill — grammar, vocabulary, reading, listening, writing,
  speaking — at fractional precision, for example B1.6.
- The overall level is derived from the per-skill levels.
- Levels update continuously after every graded item (Elo/IRT-lite).
- A checkpoint test every 2–4 weeks confirms a level-up.

## Placement

- One full test (~20 min, taken in one go) covering all skills.
- It produces a level per skill.

## Grammar

- **Syllabus:** our own CEFR syllabus (A1–C1, ~150–200 topics, with
  dependencies), reviewed by the owner. Not copied from the English Grammar
  Profile.
- **Lessons:** a mini-lesson in the native language (ru/uk), then practice.
- **Explanation methods**, adapted per learner:
  - contrast with the native language + timeline;
  - inductive;
  - a story from the learner's interests;
  - minimal pairs + a decision algorithm.
- **Mastery:** ≥85% across several exercise types, confirmed after a spaced
  interval and transferred to free production.
- Every topic is on FSRS.
- **Exercises:** choice / gap / error correction, translation from the native
  language, own sentence by rule, sentence building, transformations.
- Sessions run as a block, then interleaving.

## Vocabulary

- **"Learned" means active mastery:** recognise by ear and in text, recall from
  the translation, spell correctly, use in an own sentence, and an FSRS
  interval of more than 21 days.
- **Units:** words, collocations/chunks, phrasal verbs, idioms, word formation.
- **Sources:** frequency core + goal sets + the learner's own texts and links.
- **Backlog:** a daily review budget, most-forgettable first; new words pause
  while there is a backlog.

## Word cards

- One `sendPhoto` message with a caption: word, IPA in UK and US variants (from
  a dictionary source, not the LLM), stress and syllables, translation,
  example, collocations, attribution.
- Buttons: 🔊, another picture, know, learn.
- **Image:** Pexels first, Unsplash as fallback. The URL, author and source are
  stored in the DB.
- The LLM decides whether a word is imageable and writes the search query from
  the example. Abstract words get an emoji + mnemonic instead.

## Feedback

- Strictness depends on level and is a setting: soft / standard / pedant.
- After a mistake: hint → second attempt → explanation → a similar item
  re-queued at the end.
- Explain through contrast with the native language wherever that is the cause.
- Tone: friendly coach.

## LLM quality

- An "I'm right, re-check" button: a stronger model re-checks, and disputes are
  logged.
- Validation of generated items.
- A bank of verified items.
- Evals for every skill.

## Skills practice

- **Listening:** TTS, dictation, comprehension.
- **Reading:** LLM texts with ≤5% unknown words, plus a "send an article" mode.
- **Writing:** tasks graded against a rubric.
- **Speaking:** role-plays by voice, with pronunciation judged from the STT
  transcript.
- **Exams (IELTS/TOEFL):** later.

## Voice

- **TTS:** local Kokoro, OpenAI optional. This supersedes the earlier Piper
  decision; Kokoro landed in #40 / PR #46.
- **STT:** local faster-whisper, OpenAI optional.
- **English variant (UK/US)** is a setting, default US (#45).

## Outside-session messages

Messages sent outside a session go through a smart router:

- English text → corrections;
- a single word → add to the deck;
- a ru/uk question → tutor answer;
- then cleanup.

## Gamification

- **XP** for quality and effort: a difficulty multiplier, diminishing returns
  on easy items, goal/streak bonuses.
- A profile level.
- 500+ achievements from a declarative catalogue.
- **Streak:** freeze, restore within 24 h by doing a double goal, a "streak
  burning" reminder, milestones.
- No social features.

## Day plan

- An automatic plan within the time budget (minutes/day, slots, weekdays).
- Order: reviews → weak topics → new → skills.
- "▶ Continue plan" and "+5 min" buttons.

## Notifications

- Configurable, with quiet hours, at most 3 a day.

## Hub

- ▶ Continue plan, 👤 Profile, 📚 Dictionary, 🎧 Skills practice, plus the
  existing items.

## Reports

- Skill radar + 30-day trend (server-rendered PNG), grammar map, forecast to
  the next level, weekly report.
- A Telegram Mini App comes later.

## Onboarding

- Asks for goals (several), interests and profession.

## Ops

- **Host:** the owner's machine (docker compose).
- Postgres backups.
- No LLM cost controls for now.
- `/export`, `/delete_me`, and Anki/CSV import.

## Completeness addendum (2026-10-26)

These decisions extend the sections above and, where they conflict, override
them.

### Grammar

- **Syllabus:** covers A1–C2, not A1–C1.
- **Topic mastery rule** (supersedes the C-28 rule and the Mastery bullet in
  Grammar above):
  - ≥85% accuracy in 3 sessions spread over ≥7 days, across ≥2 exercise types;
  - and ≥2 correct uses of the topic in free production (Talk / Writing /
    Speaking) with no error tagged to that topic in the last 14 days.
  - Falling below this → `shaky`.
- **Transfer tracking:** correction skills tag every correction and every
  notable correct use with syllabus topic ids; this feeds mastery.
- **Native-language interference:** a curated catalogue of typical ru/uk → en
  errors drives targeted translation drills.
- **Grammar reference on demand:** `/rule <topic>` and "why is it X here?"
  questions get a short rule + examples + native-language contrast, without
  starting a session.
- **Personal mistake deck:** recurring error patterns from free production
  become FSRS items until they stop recurring.

### Vocabulary

- **Vocabulary size:** a monthly size test by frequency bands and a coverage
  meter ("≈N words, ~X% of B2 text").
- **Verified examples:** example sentences come from Tatoeba (CC-BY) where
  available; LLM examples are a validated fallback.
- **Word families:** learning one member links the others as related cards.

### Scheduling

- **FSRS:** per-user parameter optimisation from review history and a
  desired-retention setting (85–95%).

### Speech and writing

- **Phonetics:** a module for sounds hard for ru/uk speakers (minimal pairs by
  ear via TTS and in production via STT).
- **Functional language:** speech functions per level (apologising, refusing,
  disagreeing, small talk, business mail) and register.
- **Spelling:** dictation of words by audio and drills on common spelling
  traps.

### Quality

- A learner simulator verifies adaptation.
- When the LLM provider fails, sessions continue on the verified item bank.

### Branches

- Merges go into `develop`; `main` is fast-forwarded to `develop` after a live
  check.

### Owner decision added 2026-10-27

- **Seed content from the owner's workbook.** The owner's word list (word, part
  of speech, IPA, ru translation, CEFR level, topic, curriculum order, removed
  list), the owner's own grammar course (85 topics A2–C2 with rule sections,
  425 exercises with answers) and 137 phrasal verbs are committed to the
  repository as seed data, so the LLM is not needed for that content at the
  start.
- **Not committed:** the example sentences in the word list come from Oxford
  dictionaries and stay out of the public repository. They arrive only through
  the external import (`db:import:owner-words`, #39) from the owner's private
  file.
- **Voice:** TTS landed as local Kokoro (#40, PR #46), superseding Piper; the
  UK/US variant setting is #45.
