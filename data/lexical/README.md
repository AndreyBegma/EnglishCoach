# Lexical units

Learnable units beyond single words, loaded by `bun run db:seed` (`src/words/lexical.ts`) into
`words` with their `unit_type`; a card of one takes that type as its `item_type`.

| File | Unit | Entry |
|---|---|---|
| `phrasal-verbs.json` | `phrasal_verb` | `phrase`, `verb`, `particle` (everything after the verb: `up with`), `level` |
| `collocations.json` | `collocation` | `phrase`, `partner` (the word the learner supplies in the exercise), `level` |
| `idioms.json` | `idiom` | `phrase`, `level` — B2 and above only |
| `word-families.json` | `word_family` | `lemma`, `level`, `forms` as `[part of speech, form]` pairs |

The order inside a file is the learning order within a level.

## Sources and licence

| Content | Source | Licence |
|---|---|---|
| The first 137 phrasal verbs (`back up` … `zoom in / zoom out`) | The owner's own list, committed in `seed/phrasal-verbs.json` (translation, example and order come from there; only `verb`, `particle` and `level` are added here) | The owner's; part of this repository |
| The remaining phrasal verbs, the collocations, idioms and word families, and every `level` | Generated with an LLM (Claude) on 2026-10-27 for this repository; no third-party list was copied | Same as the repository |

No redistributable list with CEFR levels for these units was found that could be committed (the
English Vocabulary Profile is not redistributable), so the issue's fallback applies: generated
lists, a second check, a cap per level.

## The second check

`checkLexicalData` runs in the tests (`test/words/lexical.test.ts`) and again before every seed
load, which refuses to load anything if it fails:

- every generated phrasal verb's verb, every collocation's partner word and every word family's
  lemma is a headword of the CEFR dictionary (`data/words/words.csv`), spelled as there (American);
- a phrasal verb is exactly its verb plus its particle (for the owner's variants, `fill in / fill
  out`, the first one without the optional part);
- a collocation contains its partner word; collocations and idioms have more than one word;
- a word family lists its lemma among its forms and no form twice;
- idioms sit at B2 or above;
- nothing is listed twice within a file, and every owner phrasal verb is present;
- at most `LEVEL_CAPS` units of one type per level (phrasal verbs 170, collocations 60, idioms 50,
  word families 40).

Levels are a judgement, not a measurement: correct them here when a learner's data says otherwise.
