#!/usr/bin/env python3
"""Rebuilds data/pronunciation/wiktionary-en.tsv from the kaikki.org (wiktextract) English dump.

Not part of the runtime: the dump is ~3.4 GB, so stream it through (see data/pronunciation/README.md).

    curl -sSfL https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl \
      | python3 scripts/import-pronunciation-build.py > data/pronunciation/wiktionary-en.tsv

Keeps one row per lower-case headword: the first British and the first American phonemic
transcription, exactly as Wiktionary writes them, and the first hyphenation. Nothing is generated.
"""

import json
import re
import sys

HEADWORD = re.compile(r"^[A-Za-z]+(?:['\- ][A-Za-z]+)*$")
PHONEMIC = re.compile(r"^(/[^/\[\]]+/)")
UK_TAGS = {
    "Received-Pronunciation",
    "UK",
    "Standard-Southern-British",
    "British",
    "England",
    "Southern-England",
}
US_TAGS = {"General-American", "US"}


def phonemic(ipa):
    """The leading /…/ transcription (`/pleɪ/ [pʰleɪ]` → `/pleɪ/`); [narrow] ones are skipped."""
    match = PHONEMIC.match(ipa or "")
    return match.group(1) if match else None


def rank(sound, variant_tags, preferred_tag):
    """Lower is better; None when the sound is not this variant."""
    ipa = phonemic(sound.get("ipa"))
    if ipa is None:
        return None
    tags = set(sound.get("tags", []))
    weak = 10 if "weak" in (sound.get("note") or "").lower() else 0
    # The standard accent itself, even when listed together with others (Australia, RP).
    if preferred_tag in tags:
        return 0 + weak
    if tags and tags <= variant_tags:
        return 1 + weak
    # Untagged, or tagged for both UK and US: a pronunciation shared by both variants.
    if not tags or (tags <= UK_TAGS | US_TAGS and tags & UK_TAGS and tags & US_TAGS):
        return 2 + weak
    return None


def pick(sounds, variant_tags, preferred_tag):
    """(score, index, ipa) of the best sound of this variant, or None."""
    best = None
    for index, sound in enumerate(sounds):
        score = rank(sound, variant_tags, preferred_tag)
        if score is not None and (best is None or score < best[0]):
            best = (score, index, phonemic(sound["ipa"]))
    return best


def main():
    # word -> [best UK ((capitalised, score), entry, index, ipa), best US, (capitalised, hyphenation)]
    rows = {}
    for entry_index, line in enumerate(sys.stdin):
        entry = json.loads(line)
        headword = entry.get("word", "")
        if entry.get("lang_code") != "en" or not HEADWORD.match(headword):
            continue
        # Names (June, Friday) are kept under their lower-case form; the common word wins.
        word = headword.lower()
        capitalised = headword != word
        sounds = entry.get("sounds", [])
        current = rows.setdefault(word, [None, None, None])
        # The best-ranked sound over all of the word's entries; earlier entries win ties.
        for slot, (tags, preferred) in enumerate(
            ((UK_TAGS, "Received-Pronunciation"), (US_TAGS, "General-American"))
        ):
            found = pick(sounds, tags, preferred)
            if found is None:
                continue
            score = (capitalised, found[0])
            if current[slot] is None or score < current[slot][0]:
                current[slot] = (score, entry_index, found[1], found[2])
        parts = next((h.get("parts") for h in entry.get("hyphenations", []) if h.get("parts")), [])
        # The first hyphenation that spells the word; a common word's replaces a name's.
        if len(parts) > 1 and "".join(parts).lower() == word:
            if current[2] is None or (current[2][0] and not capitalised):
                current[2] = (capitalised, "·".join(parts).lower())
    out = sys.stdout
    out.write("word\tipa_uk\tipa_us\thyphenation\n")
    for word in sorted(rows):
        uk, us, hyphenation = rows[word]
        uk = uk[3] if uk else ""
        us = us[3] if us else ""
        hyphenation = hyphenation[1] if hyphenation else ""
        if uk or us or hyphenation:
            out.write(f"{word}\t{uk}\t{us}\t{hyphenation}\n")


if __name__ == "__main__":
    main()
