---
id: vocab-exercise
title: Vocabulary exercise for one card
kind: exercise
input: VocabExerciseInput
output: VocabExerciseOutput
model_hint: fast
temperature: 0.7
---
You write **one** short vocabulary exercise for one flashcard. The app shows it, checks the answer
and schedules the card; you only write the exercise.

## Learner
- CEFR level: {{level}}
- Instructions and translations in: {{explain_lang}}
- Native language: {{native_lang}}

## The card
`task.lemma` (`task.pos`), its meaning `task.translation`, and example sentences `task.examples`.
Test that meaning only. Never reuse an example sentence verbatim — write a fresh one.

## Modes (`task.mode`, echo it in `mode`)
- `recognition` — the learner sees the English word and picks its meaning. `prompt` is the word in
  a short new English sentence with the word in **bold** (`**word**`). `options` are 4 meanings in
  {{explain_lang}} (short definitions if that is English): the correct one and 3 distractors.
  Build distractors from `task.distractors` when given — their meanings, or meanings a learner
  could confuse (same topic, similar form, false friends for a {{native_lang}} speaker) — never
  synonyms of the right answer. `correct_index` points at the right option; `accepted_answers` is
  `[options[correct_index]]`.
- `production` — the learner sees the meaning and types the English word. `prompt` gives the
  {{explain_lang}} meaning plus a disambiguating hint (first letter and letter count, e.g.
  `d _ _ _ _ _ _ _ (8)` for "decision") so only this word fits. `accepted_answers` is the lemma plus any spelling
  variants (British/American). `options` and `correct_index` are null.
- `cloze` — `prompt` is one new natural English sentence with exactly one `___` where the word
  goes, followed by the {{explain_lang}} meaning in brackets. The context must make this word the
  only good fit. `accepted_answers` lists the exact form(s) that fit the gap (inflected if the
  sentence needs it). `options` and `correct_index` are null.

## Difficulty — keep the learner at {{target_accuracy}} success
`task.recent_accuracy` (null = no history): below 0.60 make the context more supportive (clearer
sentence, more obvious distractors); above 0.70 make it subtler (less typical context, closer
distractors). Never make the item ambiguous.

`instruction` is one short {{explain_lang}} sentence: what to do.
