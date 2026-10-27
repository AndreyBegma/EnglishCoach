import { describe, expect, test } from "bun:test";
import {
  BAND_SIZE,
  BANDS,
  bandOfRank,
  correctForGuessing,
  estimateSize,
  monotoneDecreasing,
  OPTIONS,
  type SizeAnswers,
} from "../../src/sizetest/estimate";

/** A seeded linear congruential generator, so the simulated learners are reproducible. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * A simulated learner: knows each word of band b with probability `known(b)`; on a word they do
 * not know (or a pseudo-word) they pick a random meaning with probability `guess`, otherwise
 * answer "I don't know".
 */
function simulate(
  known: (band: number) => number,
  guess: number,
  { perBand = 400, pseudo = 400, seed = 1 } = {},
): SizeAnswers {
  const random = rng(seed);
  const bands = Array.from({ length: BANDS }, (_, index) => {
    const band = index + 1;
    let correct = 0;
    for (let item = 0; item < perBand; item++) {
      if (random() < known(band)) correct++;
      else if (random() < guess && random() < 1 / OPTIONS) correct++;
    }
    return { band, asked: perBand, correct };
  });
  let claimed = 0;
  for (let item = 0; item < pseudo; item++) if (random() < guess) claimed++;
  return { bands, pseudo: { asked: pseudo, claimed } };
}

const knowsUpTo = (size: number) => (band: number) => (band * BAND_SIZE <= size ? 1 : 0);

describe("estimateSize", () => {
  test("an honest learner who knows the first four bands reads as 4000", () => {
    const answers: SizeAnswers = {
      bands: Array.from({ length: BANDS }, (_, i) => ({
        band: i + 1,
        asked: 4,
        correct: i < 4 ? 4 : 0,
      })),
      pseudo: { asked: 5, claimed: 0 },
    };
    const estimate = estimateSize(answers);
    expect(estimate.words).toBe(4000);
    expect(estimate.falseAlarms).toBe(0);
    expect(estimate.known.map((band) => band.share)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
  });

  test("perfect and empty answer sets reach the bounds", () => {
    const all = estimateSize({
      bands: Array.from({ length: BANDS }, (_, i) => ({ band: i + 1, asked: 4, correct: 4 })),
      pseudo: { asked: 5, claimed: 0 },
    });
    expect(all.words).toBe(BANDS * BAND_SIZE);
    const none = estimateSize({
      bands: Array.from({ length: BANDS }, (_, i) => ({ band: i + 1, asked: 4, correct: 0 })),
      pseudo: { asked: 5, claimed: 0 },
    });
    expect(none.words).toBe(0);
  });

  test("a learner who knows nothing and always guesses reads as about zero", () => {
    const estimate = estimateSize(simulate(() => 0, 1));
    expect(estimate.falseAlarms).toBe(1);
    expect(estimate.words).toBeLessThanOrEqual(300);
  });

  test("guessing without the correction would inflate the size; with it, it does not", () => {
    const honest = estimateSize(simulate(knowsUpTo(3000), 0, { seed: 7 }));
    const guesser = simulate(knowsUpTo(3000), 1, { seed: 7 });
    const corrected = estimateSize(guesser);
    const uncorrected = estimateSize({ ...guesser, pseudo: { asked: 0, claimed: 0 } });

    expect(honest.words).toBe(3000);
    // Unknown bands at 25% raw accuracy: 7 bands × 250 words of inflation without the correction.
    expect(uncorrected.words).toBeGreaterThan(4500);
    expect(Math.abs(corrected.words - 3000)).toBeLessThanOrEqual(300);
  });

  test("answering 'I know it' on pseudo-words lowers the estimate", () => {
    // Bands partly known: their right answers are the ones guessing could explain away.
    const base = simulate((band) => Math.max(0, 1 - band * 0.15), 0, { seed: 3 });
    const clean = estimateSize(base);
    const claiming = estimateSize({ ...base, pseudo: { asked: base.pseudo.asked, claimed: 200 } });
    expect(claiming.falseAlarms).toBe(0.5);
    expect(claiming.words).toBeLessThan(clean.words);
  });

  test("a graded learner (shares falling with rarity) lands near the expected sum", () => {
    const profile = (band: number) => Math.max(0, 1 - (band - 1) * 0.12);
    const expected = Array.from({ length: BANDS }, (_, i) => profile(i + 1)).reduce(
      (sum, share) => sum + share * BAND_SIZE,
      0,
    );
    const estimate = estimateSize(
      simulate(profile, 0.5, { seed: 11, perBand: 2000, pseudo: 2000 }),
    );
    expect(Math.abs(estimate.words - expected)).toBeLessThanOrEqual(250);
  });

  test("noise where a rarer band beats a commoner one is smoothed, not summed", () => {
    const estimate = estimateSize({
      bands: [
        { band: 1, asked: 4, correct: 4 },
        { band: 2, asked: 4, correct: 2 },
        { band: 3, asked: 4, correct: 4 },
      ],
      pseudo: { asked: 5, claimed: 0 },
    });
    const shares = estimate.known.map((band) => band.share);
    expect(shares.slice(0, 3)).toEqual([1, 0.75, 0.75]);
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i] ?? 0).toBeLessThanOrEqual(shares[i - 1] ?? 0);
    }
    expect(estimate.words).toBe(2500);
  });

  test("results are rounded to 50 words", () => {
    const estimate = estimateSize({
      bands: [
        { band: 1, asked: 3, correct: 3 },
        { band: 2, asked: 3, correct: 1 },
      ],
      pseudo: { asked: 0, claimed: 0 },
    });
    // 1000 + 333.3 → 1350.
    expect(estimate.words).toBe(1350);
  });
});

describe("correctForGuessing", () => {
  test("no false alarms leaves accuracy as it is", () => {
    expect(correctForGuessing(0.6, 0)).toBe(0.6);
  });
  test("chance-level accuracy of a full guesser is zero, never negative", () => {
    expect(correctForGuessing(1 / OPTIONS, 1)).toBe(0);
    expect(correctForGuessing(0, 1)).toBe(0);
  });
  test("perfect accuracy stays perfect", () => {
    expect(correctForGuessing(1, 1)).toBe(1);
  });
});

describe("monotoneDecreasing", () => {
  test("pools violators by weight", () => {
    expect(monotoneDecreasing([0.5, 1], [1, 3])).toEqual([0.875, 0.875]);
  });
  test("an unweighted band takes its successor's value", () => {
    expect(monotoneDecreasing([1, 0, 0.5, 0], [4, 0, 4, 4])).toEqual([1, 0.5, 0.5, 0]);
  });
});

describe("bandOfRank", () => {
  test("maps ranks to 1k bands and rejects the rest", () => {
    expect(bandOfRank(1)).toBe(1);
    expect(bandOfRank(1000)).toBe(1);
    expect(bandOfRank(1001)).toBe(2);
    expect(bandOfRank(10_000)).toBe(10);
    expect(bandOfRank(10_001)).toBeNull();
    expect(bandOfRank(0)).toBeNull();
  });
});
