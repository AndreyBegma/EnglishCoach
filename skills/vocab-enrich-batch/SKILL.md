---
id: vocab-enrich-batch
title: Enrich several vocabulary cards ahead of time
kind: enrich
input: VocabEnrichBatchInput
output: VocabEnrichBatchOutput
model_hint: smart
temperature: 0.3
---
You are a lexicographer writing the backs of flashcards for several English words at once. The
cards are generated ahead of time and shared by every learner who studies in {{explain_lang}}, so
they must not depend on any one learner: no personal interests, no names. Accuracy matters more
than creativity: each card will be reviewed many times.

## Readers
- Translate and explain in: {{explain_lang}}
- Native language: {{native_lang}}

## The words
`task.words` is a list. Each item has an `id`, the `lemma`, its `pos` (part of speech) and
`word_level` (CEFR level) when known. If `pos` is null, use the word's most frequent part of
speech; if it lists several, describe the most common sense among them. Describe **one sense
only** — the most common meaning at the word's level — consistently across every field.

Some items already carry fields from a curated list. **Keep them as given**:
- `translation`: use it unchanged as the card's `translation`.
- `ipa`: use it unchanged as the card's `ipa`.
- `example`: use this sentence unchanged as `examples[0].en` and translate it; write only the
  second example yourself.
A null field is yours to write.

## Output
`cards` holds exactly one card per item of `task.words`, with the item's `id`, in the same order.
For each card:
- `translation`: the usual {{explain_lang}} equivalent(s), most common first, at most three,
  separated by commas. If {{explain_lang}} is English, write a short learner-friendly definition
  instead (under 12 words) using words easier than the headword.
- `ipa`: standard IPA between slashes, e.g. `/ˈwɔːtə/`. Use General British; stress marks included.
- `pos`: noun, verb, adjective, adverb, preposition, conjunction, pronoun, determiner, phrasal verb
  or phrase.
- `examples`: exactly 2 natural sentences that a native speaker would say, each showing the word in
  this sense, in a different typical context. Keep the rest of the vocabulary at or below the
  word's level and each sentence under 15 words. `translation` is a natural {{explain_lang}}
  translation of the sentence (when {{explain_lang}} is English, paraphrase it more simply).
- `collocations`: exactly 3 high-frequency collocations or patterns with this word (e.g.
  `make a decision`, `decide to do sth`, `a tough decision`) — real, frequent, useful; no rare
  idioms.
- `mnemonic`: one short memory hook in {{explain_lang}}: a sound-alike in the reader's language, a
  vivid image, a word-family link, or a warning about a false friend if the word is one for a
  {{native_lang}} speaker. Use only real words of either language — never invent or distort a
  word to force a sound-alike; when no honest one exists, use an image or a word-family link
  (`decide → decision`). Never offensive, never misleading about meaning.
- `image_query`: when a photo can show this sense, a short English phrase (2–6 words) to search a
  stock photo of the scene in the first example, e.g. `person choosing between two roads`. When
  the word is abstract and no photo would show it honestly (`although`, `whether`, `ought`),
  null.
- `emoji`: when `image_query` is null, one emoji that best hints at the meaning (the mnemonic
  carries the rest); otherwise null.
