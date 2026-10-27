/**
 * Builds `data/coverage/curve.json`: the share of running text covered by the N most frequent
 * words, for N in steps of `STEP` up to the size test's last band.
 *
 * `data/words/words.csv` carries wordfreq frequency *ranks*, not counts, so the counts are
 * modelled: a Zipf–Mandelbrot law `f(r) ∝ 1 / (r + q)^s` over a lexicon of `V` ranks, `s`, `q`
 * and `V` fitted (least squares, grid search) to the published coverage of headword lists in general text
 * (`ANCHORS`, after Nation 2006 and Adolphs & Schmitt 2003). The numbers are the shape of the
 * curve only; no word list is copied. Rerun after changing the anchors:
 *
 *   bun scripts/build-coverage.ts
 */
import { BAND_SIZE, BANDS } from "../src/sizetest/estimate";
import { COVERAGE_CURVE_PATH, type CoverageCurve } from "../src/words/coverage";

/** Words known → share of running general text they cover. */
const ANCHORS: readonly [number, number][] = [
  [1000, 0.81],
  [2000, 0.88],
  [3000, 0.91],
  [4000, 0.94],
  [5000, 0.95],
  [8000, 0.97],
  [10000, 0.98],
];
/** Candidate sizes of the modelled lexicon (ranks with any weight); fitted with `s` and `q`. */
const VOCABULARIES = [20_000, 30_000, 50_000, 100_000, 300_000];
const MAX_VOCABULARY = 300_000;
const STEP = 250;

function cumulative(s: number, q: number): Float64Array {
  const sums = new Float64Array(MAX_VOCABULARY + 1);
  for (let rank = 1; rank <= MAX_VOCABULARY; rank++) {
    sums[rank] = (sums[rank - 1] ?? 0) + (rank + q) ** -s;
  }
  return sums;
}

interface Fit {
  s: number;
  q: number;
  vocabulary: number;
  sums: Float64Array;
  error: number;
}

function fit(): Fit {
  let best: Fit | undefined;
  for (let s = 1.0; s <= 2.0001; s += 0.02) {
    for (let q = 0; q <= 60; q += 1) {
      const sums = cumulative(s, q);
      for (const vocabulary of VOCABULARIES) {
        const total = sums[vocabulary] ?? 1;
        const error = ANCHORS.reduce(
          (sum, [n, share]) => sum + ((sums[n] ?? 0) / total - share) ** 2,
          0,
        );
        if (!best || error < best.error) best = { s, q, vocabulary, sums, error };
      }
    }
  }
  if (!best) throw new Error("no fit");
  return best;
}

const { s, q, vocabulary, sums, error } = fit();
const total = sums[vocabulary] ?? 1;
const points: [number, number][] = [[0, 0]];
for (let n = STEP; n <= BANDS * BAND_SIZE; n += STEP) {
  points.push([n, Math.round(((sums[n] ?? 0) / total) * 10_000) / 10_000]);
}
const curve: CoverageCurve = {
  model: `zipf-mandelbrot s=${s.toFixed(2)} q=${q} V=${vocabulary}`,
  rmse: Math.round(Math.sqrt(error / ANCHORS.length) * 10_000) / 10_000,
  points,
};
await Bun.write(COVERAGE_CURVE_PATH, `${JSON.stringify(curve, null, 2)}\n`);
console.log(`${curve.model}, rmse ${curve.rmse}, ${points.length} points → ${COVERAGE_CURVE_PATH}`);
