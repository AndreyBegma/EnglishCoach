import type { Db } from "../db/client";
import { type SizeTestCandidate, sizeTestCandidates } from "../db/repositories/sizetest";
import type { Language, SizeTestAnswer, SizeTestItem } from "../db/schema";
import { BAND_SIZE, BANDS, OPTIONS, type SizeAnswers } from "./estimate";
import { PSEUDO_WORDS } from "./pseudowords";

/** Real words asked per band. */
export const PER_BAND = 4;
/** Pseudo-words mixed in. */
export const PSEUDO_ITEMS = 5;
/** A meaning longer than this is cut on its button. */
const MAX_OPTION_CHARS = 40;

/** A random integer in `[0, below)`; tests pin it. */
export type Pick = (below: number) => number;
export const randomPick: Pick = (below) => Math.floor(Math.random() * below);

function shuffle<T>(list: readonly T[], pick: Pick): T[] {
  const out = [...list];
  for (let index = out.length - 1; index > 0; index--) {
    const other = pick(index + 1);
    [out[index], out[other]] = [out[other] as T, out[index] as T];
  }
  return out;
}

const clip = (text: string) =>
  text.length <= MAX_OPTION_CHARS ? text : `${text.slice(0, MAX_OPTION_CHARS - 1).trimEnd()}…`;

/** Up to `count` meanings from `pool`, none equal to any of `avoid`, all distinct. */
function distractors(pool: readonly string[], avoid: string, count: number, pick: Pick): string[] {
  const seen = new Set([avoid.toLowerCase()]);
  const out: string[] = [];
  for (const meaning of shuffle(pool, pick)) {
    if (out.length === count) break;
    if (seen.has(meaning.toLowerCase())) continue;
    seen.add(meaning.toLowerCase());
    out.push(meaning);
  }
  return out;
}

/**
 * The test's items from the sampled words per band (index 0 = band 1): `PER_BAND` of each band,
 * then `PSEUDO_ITEMS` pseudo-words, shuffled together. Every item offers `OPTIONS` meanings, the
 * distractors drawn from the other sampled words; a pseudo-word's are all wrong. Returns an empty
 * list when there are not enough distinct meanings to fill the options.
 */
export function buildItems(
  byBand: readonly (readonly SizeTestCandidate[])[],
  pick: Pick = randomPick,
): SizeTestItem[] {
  const all = byBand
    .flat()
    .map((candidate) => ({ ...candidate, meaning: clip(candidate.meaning) }));
  const meanings = [...new Set(all.map((candidate) => candidate.meaning))];
  if (meanings.length < OPTIONS + 1) return [];

  // A lemma can have two rows (the seed's and the owner's); it is asked once.
  const asked = new Set<string>();
  const fresh = (candidate: SizeTestCandidate) => {
    const lemma = candidate.lemma.toLowerCase();
    if (asked.has(lemma)) return false;
    asked.add(lemma);
    return true;
  };
  const real: SizeTestItem[] = byBand.flatMap((candidates, index) =>
    candidates
      .filter(fresh)
      .slice(0, PER_BAND)
      .map((candidate) => {
        const meaning = clip(candidate.meaning);
        const options = shuffle(
          [meaning, ...distractors(meanings, meaning, OPTIONS - 1, pick)],
          pick,
        );
        return {
          word: candidate.lemma,
          wordId: candidate.wordId,
          band: index + 1,
          options,
          answer: options.indexOf(meaning),
        };
      }),
  );
  const pseudo: SizeTestItem[] = shuffle(PSEUDO_WORDS, pick)
    .slice(0, PSEUDO_ITEMS)
    .map((word) => ({
      word,
      wordId: null,
      band: null,
      options: distractors(meanings, "", OPTIONS, pick),
      answer: null,
    }));
  return shuffle([...real, ...pseudo], pick);
}

/** Samples the words of every band from the database and builds the items. */
export async function prepareItems(
  db: Db,
  lang: Language,
  pick: Pick = randomPick,
): Promise<SizeTestItem[]> {
  const byBand = await Promise.all(
    Array.from({ length: BANDS }, (_, index) =>
      sizeTestCandidates(db, lang, index * BAND_SIZE + 1, (index + 1) * BAND_SIZE, PER_BAND + 2),
    ),
  );
  // Every band must be asked at least once, or its share would be borrowed rather than measured.
  if (byBand.some((candidates) => candidates.length === 0)) return [];
  return buildItems(byBand, pick);
}

/** Tallies the answers per band and on the pseudo-words, for the estimator. */
export function tally(
  items: readonly SizeTestItem[],
  answers: readonly SizeTestAnswer[],
): SizeAnswers {
  const bands = new Map<number, { band: number; asked: number; correct: number }>();
  const pseudo = { asked: 0, claimed: 0 };
  items.forEach((item, index) => {
    if (index >= answers.length) return;
    const answer = answers[index] ?? null;
    if (item.band === null) {
      pseudo.asked++;
      if (answer !== null) pseudo.claimed++;
      return;
    }
    const entry = bands.get(item.band) ?? { band: item.band, asked: 0, correct: 0 };
    entry.asked++;
    if (answer !== null && answer === item.answer) entry.correct++;
    bands.set(item.band, entry);
  });
  return { bands: [...bands.values()], pseudo };
}
