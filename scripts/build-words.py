#!/usr/bin/env python3
"""Rebuilds data/words/words.csv from the CEFR-J and Octanove lists plus wordfreq ranks.

Not part of the runtime: run it from a throwaway venv (see data/words/README.md).

    python3 scripts/build-words.py <cefrj.csv> <octanove-c1c2.csv> <output.csv>
"""

import csv
import re
import sys

from wordfreq import top_n_list

POS_MAP = {
    "noun": "noun",
    "verb": "verb",
    "vern": "verb",  # upstream typo in the Octanove list
    "adjective": "adjective",
    "adverb": "adverb",
    "preposition": "preposition",
    "conjunction": "conjunction",
    "pronoun": "pronoun",
    "determiner": "determiner",
    "interjection": "interjection",
    "number": "number",
    "modal auxiliary": "modal",
    "be-verb": "verb",
    "do-verb": "verb",
    "have-verb": "verb",
}
LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]
PLAIN_WORD = re.compile(r"^[a-z]+(?:['-][a-z]+)*$")


def read_rows(path, source):
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            pos = POS_MAP.get((row.get("pos") or "").strip())
            level = (row.get("CEFR") or "").strip()
            if pos is None or level not in LEVEL_ORDER:
                continue
            # Multi-form headwords ("a.m./A.M./am/AM") are dropped unless the first form is plain.
            lemma = row["headword"].split("/")[0].strip().lower()
            if not PLAIN_WORD.match(lemma):
                continue
            yield lemma, pos, level, source


def main(cefrj_path, octanove_path, out_path):
    best = {}
    for path, source in ((cefrj_path, "cefr-j-1.5"), (octanove_path, "octanove-c1c2-1.0")):
        for lemma, pos, level, src in read_rows(path, source):
            key = (lemma, pos)
            if key not in best or LEVEL_ORDER.index(level) < LEVEL_ORDER.index(best[key][0]):
                best[key] = (level, src)

    ranks = {word: index + 1 for index, word in enumerate(top_n_list("en", 300000, wordlist="large"))}
    rows = sorted(
        ((lemma, pos, level, ranks.get(lemma)) for (lemma, pos), (level, _) in best.items()),
        key=lambda r: (r[3] is None, r[3] or 0, r[0], r[1]),
    )
    with open(out_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["lemma", "pos", "cefr_level", "frequency_rank"])
        for lemma, pos, level, rank in rows:
            writer.writerow([lemma, pos, level, "" if rank is None else rank])
    print(f"wrote {len(rows)} rows")


if __name__ == "__main__":
    main(*sys.argv[1:4])
