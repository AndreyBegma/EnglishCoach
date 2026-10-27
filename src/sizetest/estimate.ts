/**
 * The vocabulary size estimator. Pure: answers in, a size out. Items come from frequency bands of
 * `BAND_SIZE` ranks; each is a meaning question with `OPTIONS` meanings and "I don't know".
 *
 * Guessing correction: a pseudo-word has no right meaning, so choosing any is a false alarm, and
 * the false-alarm rate `f` is how often this learner picks a meaning for a word they do not know.
 * On an unknown real word such a pick is right 1 in `OPTIONS` times, so a band's accuracy `a` is
 * `p + (1 − p)·g` with `g = f / OPTIONS`, and the share known is `p = (a − g) / (1 − g)`.
 */

/** Frequency ranks per band; band 1 is ranks 1–1000. */
export const BAND_SIZE = 1000;
/** Bands tested: up to the 10k most frequent words. */
export const BANDS = 10;
/** Meanings offered per item (besides "I don't know"). */
export const OPTIONS = 4;
/** Estimates are shown rounded to this many words; finer digits would be noise. */
export const ROUND_TO = 50;

export interface BandTally {
  /** 1-based band: ranks `(band − 1)·BAND_SIZE + 1 … band·BAND_SIZE`. */
  band: number;
  asked: number;
  correct: number;
}

export interface SizeAnswers {
  bands: readonly BandTally[];
  pseudo: { asked: number; claimed: number };
}

export interface SizeEstimate {
  /** Estimated known words among the tested ranks, rounded to `ROUND_TO`. */
  words: number;
  /** Per band, the corrected share known (0..1), after the monotone fit. */
  known: { band: number; share: number }[];
  /** The pseudo-word false-alarm rate (0..1). */
  falseAlarms: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Corrects one band's accuracy for guessing at the given false-alarm rate. */
export function correctForGuessing(accuracy: number, falseAlarms: number): number {
  const guess = clamp01(falseAlarms) / OPTIONS;
  return clamp01((accuracy - guess) / (1 - guess));
}

/**
 * Least-squares non-increasing fit (pool adjacent violators), weighted by items asked: a learner
 * knows rarer words no better than commoner ones, so a band beating the one before is noise.
 */
export function monotoneDecreasing(
  values: readonly number[],
  weights: readonly number[],
): number[] {
  const blocks: { sum: number; weight: number; count: number }[] = [];
  values.forEach((value, index) => {
    const weight = weights[index] ?? 0;
    blocks.push({ sum: value * weight, weight, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (!last || !prev || mean(prev) >= mean(last)) break;
      blocks.splice(-2, 2, {
        sum: prev.sum + last.sum,
        weight: prev.weight + last.weight,
        count: prev.count + last.count,
      });
    }
  });
  return blocks.flatMap((block) => Array<number>(block.count).fill(mean(block)));
}

function mean(block: { sum: number; weight: number }): number {
  return block.weight === 0 ? 0 : block.sum / block.weight;
}

/**
 * Σ over bands of `BAND_SIZE × share known`. A band with no item asked borrows its neighbour's
 * share through the monotone fit (weight 0), or counts as unknown when nothing follows it.
 */
export function estimateSize(answers: SizeAnswers): SizeEstimate {
  const falseAlarms =
    answers.pseudo.asked === 0 ? 0 : answers.pseudo.claimed / answers.pseudo.asked;
  const bands = Array.from({ length: BANDS }, (_, index) => {
    const tally = answers.bands.find((entry) => entry.band === index + 1);
    const asked = tally?.asked ?? 0;
    const accuracy = asked === 0 ? 0 : (tally?.correct ?? 0) / asked;
    return { band: index + 1, asked, share: correctForGuessing(accuracy, falseAlarms) };
  });
  const fitted = monotoneDecreasing(
    bands.map((band) => band.share),
    bands.map((band) => band.asked),
  );
  const known = bands.map((band, index) => ({ band: band.band, share: fitted[index] ?? 0 }));
  const raw = known.reduce((sum, band) => sum + BAND_SIZE * band.share, 0);
  return { words: Math.round(raw / ROUND_TO) * ROUND_TO, known, falseAlarms };
}

/** The band a frequency rank falls in, or null beyond the tested ranks. */
export function bandOfRank(rank: number): number | null {
  if (!Number.isInteger(rank) || rank < 1 || rank > BANDS * BAND_SIZE) return null;
  return Math.ceil(rank / BAND_SIZE);
}
