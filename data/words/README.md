# CEFR frequency dictionary

`words.csv` (`lemma, pos, cefr_level, frequency_rank`) is seeded into the `words` table with
`bun run db:seed:words` (idempotent upsert on `(lemma, pos)`).

## Licence of `words.csv`

**Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)** —
<https://creativecommons.org/licenses/by-sa/4.0/>. The file combines the sources below; the
share-alike terms of the Octanove list and of the wordfreq data apply to it, so redistribute it under
the same licence with the attribution listed here. The project's source code is not affected.

## Sources

| Source | Used for | Licence |
|---|---|---|
| CEFR-J Vocabulary Profile 1.5 (A1–B2), compiled by Yukio Tono, Tono Laboratory, Tokyo University of Foreign Studies (TUFS). <http://www.cefr-j.org/download.html>, mirrored by Open Language Profiles: <https://github.com/openlanguageprofiles/olp-en-cefrj/blob/master/cefrj-vocabulary-profile-1.5.csv> | headwords, part of speech, levels A1–B2 | Free for research and commercial use provided the dataset is cited; copyright TUFS |
| Octanove Vocabulary Profile C1/C2 1.0 by Octanove Labs. <https://github.com/openlanguageprofiles/olp-en-cefrj/blob/master/octanove-vocabulary-profile-c1c2-1.0.csv> | headwords, part of speech, levels C1–C2 | CC BY-SA 4.0 |
| `wordfreq` 3.1.1 by Robyn Speer. <https://github.com/rspeer/wordfreq> | `frequency_rank` (position in the English "large" word list, 1 = most frequent) | code Apache-2.0, data CC BY-SA 4.0 |

Only the derived integer rank from `wordfreq` is stored, not its data. **Caveat:** wordfreq's English
data is a blend that includes Google Books Ngrams, Wikipedia, OpenSubtitles, SUBTLEX and a Twitter
sample, each under its own terms (see the wordfreq README). We store derived ranks only and judge
that fine; if that stops being acceptable, regenerate the ranks from another source.

Words missing from the wordfreq list have an empty `frequency_rank` (NULL) and sort last.

## Cleaning applied

- Rows without a recognised part of speech or CEFR level are dropped (upstream typo `vern` is read as `verb`).
- Headwords with several forms (`a.m./A.M./am/AM`) are reduced to the first form, and dropped if that
  is not a plain lower-case word (letters, inner `'` or `-`).
- `be-verb`, `do-verb` and `have-verb` become `verb`; `modal auxiliary` becomes `modal`.
- A `(lemma, pos)` pair present in both lists keeps its lowest level.

## Regenerating

```sh
python3 -m venv /tmp/words-venv && /tmp/words-venv/bin/pip install wordfreq==3.1.1
/tmp/words-venv/bin/python scripts/build-words.py cefrj-vocabulary-profile-1.5.csv \
  octanove-vocabulary-profile-c1c2-1.0.csv data/words/words.csv
```
