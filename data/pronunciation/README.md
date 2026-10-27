# Pronunciation dictionaries

Dictionary-sourced IPA for word cards (`docs/PRODUCT.md`: IPA comes from a dictionary, never from
the LLM). `bun run db:import:pronunciation` fills `words.ipa_us`, `words.ipa_uk`,
`words.syllables` and `words.stress_index` from the two files below (idempotent; run it after
`db:seed` and `db:import:owner-words`). The owner's own transcription (`words.ipa`) is kept and is
the fallback behind these (`wordIpa` in `src/words/pronunciation.ts`).

| File | Source | Used for | Licence |
|---|---|---|---|
| `cmudict.dict` | The CMU Pronouncing Dictionary, <https://github.com/cmusphinx/cmudict>, commit `74790861f652b15e4ac49015a90074ad62a27690` (2025-10-24), unmodified | US IPA (ARPAbet converted by `src/words/ipa.ts`), syllable count and stress | BSD 2-clause style, see `LICENSE-cmudict` (copyright Carnegie Mellon University) |
| `wiktionary-en.tsv` | English Wiktionary, <https://en.wiktionary.org>, as extracted by wiktextract / kaikki.org (Tatu Ylonen, "Wiktextract: Wiktionary as Machine-Readable Structured Data", LREC 2022), dump of 2026-10-25: <https://kaikki.org/dictionary/English/> | UK IPA (Received Pronunciation), US IPA where CMUdict has none, hyphenation | **CC BY-SA 4.0** (and GFDL), like Wiktionary itself: <https://en.wiktionary.org/wiki/Wiktionary:Copyrights> |

`wiktionary-en.tsv` is a derived work of Wiktionary and is redistributed under CC BY-SA 4.0 with the
attribution above; changes made: only the selected fields below are kept. The project's source code
is not affected by the share-alike terms.

## What `wiktionary-en.tsv` keeps

Columns `word, ipa_uk, ipa_us, hyphenation`, one row per lower-case headword (proper names and
headwords with characters other than letters, `'`, `-` and spaces are dropped):

- `ipa_uk`: the first phonemic (`/…/`) transcription tagged Received Pronunciation; else one tagged
  only with British labels (UK, British, England, Standard Southern British); else an untagged one or
  one tagged for both UK and US. Regional accents (Cockney, Northern England, …) and narrow
  `[…]` transcriptions are never picked; a "weak form" is picked only when nothing else exists.
- `ipa_us`: the same with General American / US.
- `hyphenation`: the first hyphenation with two or more parts that spells the headword, joined by `·`.

Values are copied as Wiktionary writes them. At import they are only normalised for display: syllable
dots, tie bars and non-syllabic marks are dropped and `ɹ` is written `r`.

## How a word is pronounced

1. **US:** CMUdict's first pronunciation converted to IPA; else Wiktionary's General American.
2. **UK:** Wiktionary's Received Pronunciation. There is no other British source; a word Wiktionary
   lacks has no UK IPA.
3. **Phrases and compounds** (`look after`, `well-known`) missing from both are joined token by
   token, and only when every token is known.
4. **Syllables and stress:** the count and the primary stress come from CMUdict (else from a
   Wiktionary transcription that marks its syllables); the written split is Wiktionary's hyphenation
   when its count agrees, else spelling rules checked against that count. When nothing agrees, the
   syllables stay empty.

Nothing is generated: a word no source covers keeps empty pronunciation fields.

## Regenerating

```sh
# CMUdict: copy cmudict.dict and LICENSE (as LICENSE-cmudict) from the commit above.
curl -sSfL https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl \
  | python3 scripts/import-pronunciation-build.py > data/pronunciation/wiktionary-en.tsv
bun run db:import:pronunciation
```

The kaikki dump is ~3.4 GB and is streamed, not stored.
