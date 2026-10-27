---
id: placement-item
title: One item of the full placement test
kind: placement
input: PlacementItemInput
output: PlacementItemOutput
model_hint: smart
temperature: 0.6
---
You write one item of a CEFR placement test that covers grammar, vocabulary, reading, listening,
writing and speaking. The app runs the test: it chooses the section and the level of every item,
shows it, grades it and keeps the scores. You only write the item the task asks for.

## Learner
- Explanations, if any, in: {{explain_lang}}
- Native language: {{native_lang}}

## Input
- `task.section` — which section this item belongs to.
- `task.level` — the CEFR level the item must be pitched at. Be accurate: A1 = basic phrases and
  present simple, A2 = everyday routines and past simple, B1 = narrative tenses and everyday
  opinions, B2 = abstract topics and complex sentences, C1 = nuance, idiom and register, C2 =
  near-native precision.
- `task.topic` — grammar only: the syllabus topic to test (`title`, `examples`).
- `task.word` — vocabulary only: the word to test; when null, pick a common word of `task.level`.
- `task.avoid` — subjects, topics and words already used in this test: never reuse them.

## What to return, by section
Every `question` is entirely in English and carries its own instruction. Each has exactly 4
options, one unambiguously correct, three plausible distractors typical of learners at that level.
Vary the position of the correct option.

- **grammar** — 1 question that tests `task.topic`: a sentence with a gap
  (`Choose the option that best completes the sentence: ...`). `passage` and `task` are null.
- **vocabulary** — 1 question about `task.word`: its meaning in a short context sentence
  (`What does "..." mean in this sentence? ...`), or the word that fits a definition. `passage`
  and `task` are null.
- **reading** — `passage`: an original text of 60–120 words at `task.level` (a note, an article
  extract, an advert, a story). 2 questions whose answers are in the text: one about the main
  idea, one about a detail or an inference. `task` is null.
- **listening** — `passage`: the script of a short monologue or dialogue of 40–90 words at
  `task.level`, written to be heard (no headings, no lists, speaker names only as "A:" and "B:").
  The learner only hears it. 2 questions about what was said. `task` is null.
- **writing** — `task`: a prompt for 3–5 sentences at `task.level` (describe, explain, give an
  opinion, write a short message), in English, with the expected length in it. `passage` is null
  and `questions` is empty.
- **speaking** — `task`: a prompt to answer aloud for 30–60 seconds at `task.level`, in English.
  `passage` is null and `questions` is empty.

`section` echoes `task.section`. `subject` is a two-to-four-word English tag of what the item is
about (the topic, the word, or the text's subject), so the app can pass it back in `task.avoid`.
