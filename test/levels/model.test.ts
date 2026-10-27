import { describe, expect, test } from "bun:test";
import {
  bandCentre,
  bandOf,
  drift,
  expectedScore,
  formatCefr,
  type LevelState,
  MAX_RATING,
  MIN_UNCERTAINTY,
  overall,
  PRIOR,
  parseCefr,
  pitched,
  update,
} from "../../src/levels/model";
import { CEFR_LEVELS } from "../../src/settings/options";

/** A seeded generator, so the simulations are the same on every run. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A learner of true level `ability` answering `n` items spread over the whole scale. */
function simulate(ability: number, n: number, seed: number, start: LevelState = PRIOR) {
  const random = mulberry32(seed);
  const trace: LevelState[] = [start];
  let state = start;
  for (let i = 0; i < n; i++) {
    const difficulty = bandCentre(CEFR_LEVELS[Math.floor(random() * 6)] ?? "B1");
    const score = random() < expectedScore(ability, difficulty) ? 1 : 0;
    state = update(state, difficulty, score);
    trace.push(state);
  }
  return trace;
}

describe("rating ↔ CEFR decimal", () => {
  test("every decimal on the scale round-trips", () => {
    for (const level of CEFR_LEVELS) {
      for (let tenth = 0; tenth <= 9; tenth++) {
        const text = `${level}.${tenth}`;
        const rating = parseCefr(text);
        expect(rating).toBeDefined();
        expect(formatCefr(rating as number)).toBe(text);
      }
    }
  });

  test("a rating survives format → parse to its tenth", () => {
    for (let rating = 0; rating <= MAX_RATING; rating += 0.037) {
      const text = formatCefr(rating);
      const back = parseCefr(text) as number;
      expect(back).toBeLessThanOrEqual(rating + 1e-9);
      expect(rating - back).toBeLessThan(0.1);
      expect(formatCefr(back)).toBe(text);
    }
  });

  test("the examples of the scale", () => {
    expect(formatCefr(0)).toBe("A1.0");
    expect(formatCefr(2.6)).toBe("B1.6");
    expect(formatCefr(2.3)).toBe("B1.3");
    expect(formatCefr(5.9)).toBe("C2.9");
    expect(parseCefr("B1.6")).toBeCloseTo(2.6);
  });

  test("ratings outside the scale clamp; junk does not parse", () => {
    expect(formatCefr(-1)).toBe("A1.0");
    expect(formatCefr(9)).toBe("C2.9");
    expect(bandOf(9)).toBe("C2");
    expect(parseCefr("B3.1")).toBeUndefined();
    expect(parseCefr("B1")).toBeUndefined();
    expect(parseCefr("B1.12")).toBeUndefined();
  });

  test("a band's centre is in that band", () => {
    for (const level of CEFR_LEVELS) expect(bandOf(bandCentre(level))).toBe(level);
  });
});

describe("updates", () => {
  test("converges on a simulated learner of known level", () => {
    for (const [ability, seed] of [
      [1.3, 1],
      [2.6, 2],
      [4.4, 3],
    ] as const) {
      const trace = simulate(ability, 400, seed);
      const last = trace.at(-1) as LevelState;
      expect(Math.abs(last.rating - ability)).toBeLessThan(0.35);
      // Not a lucky last step: the tail stays close too.
      const tail = trace.slice(-100).map((state) => state.rating);
      const mean = tail.reduce((sum, rating) => sum + rating, 0) / tail.length;
      expect(Math.abs(mean - ability)).toBeLessThan(0.25);
    }
  });

  test("finds the level from a wrong seed", () => {
    const last = simulate(4.2, 400, 7, { rating: 1, uncertainty: 0.8 }).at(-1) as LevelState;
    expect(Math.abs(last.rating - 4.2)).toBeLessThan(0.4);
  });

  test("uncertainty decreases with evidence, down to its floor", () => {
    const trace = simulate(2.6, 200, 5);
    for (let i = 1; i < trace.length; i++) {
      expect((trace[i] as LevelState).uncertainty).toBeLessThanOrEqual(
        (trace[i - 1] as LevelState).uncertainty + 1e-12,
      );
    }
    expect((trace[10] as LevelState).uncertainty).toBeLessThan(PRIOR.uncertainty);
    expect((trace.at(-1) as LevelState).uncertainty).toBeCloseTo(MIN_UNCERTAINTY);
  });

  test("success moves up, failure down; a surprise moves more than the expected", () => {
    const start = { rating: 2.5, uncertainty: 0.6 };
    expect(update(start, 2.5, 1).rating).toBeGreaterThan(2.5);
    expect(update(start, 2.5, 0).rating).toBeLessThan(2.5);
    const upsetWin = update(start, 4.5, 1).rating - 2.5;
    const easyWin = update(start, 0.5, 1).rating - 2.5;
    expect(upsetWin).toBeGreaterThan(easyWin);
  });

  test("partial credit lands between a pass and a fail", () => {
    const start = { rating: 2.5, uncertainty: 0.6 };
    const half = update(start, 2.5, 0.5).rating;
    expect(half).toBeCloseTo(2.5);
    expect(update(start, 3, 0.5).rating).toBeGreaterThan(update(start, 3, 0).rating);
  });

  test("a confident rating barely moves", () => {
    const sure = update({ rating: 2.5, uncertainty: MIN_UNCERTAINTY }, 2.5, 0).rating;
    const unsure = update({ rating: 2.5, uncertainty: 1.2 }, 2.5, 0).rating;
    expect(2.5 - sure).toBeLessThan(2.5 - unsure);
  });

  test("pitched items do not inflate the rating of a learner who scores as designed", () => {
    // A B1 learner who passes 90 % of B1 reviews stays B1.
    const random = mulberry32(11);
    let state: LevelState = { rating: bandCentre("B1"), uncertainty: 0.6 };
    for (let i = 0; i < 500; i++) {
      state = update(state, pitched(bandCentre("B1"), 0.9), random() < 0.9 ? 1 : 0);
    }
    expect(bandOf(state.rating)).toBe("B1");
  });

  test("idle days widen the uncertainty, never past the prior", () => {
    const state = { rating: 2.5, uncertainty: MIN_UNCERTAINTY };
    expect(drift(state, 0).uncertainty).toBe(MIN_UNCERTAINTY);
    expect(drift(state, 30 * 86_400_000).uncertainty).toBeGreaterThan(MIN_UNCERTAINTY);
    expect(drift(state, 1e15).uncertainty).toBeCloseTo(PRIOR.uncertainty);
  });
});

describe("overall level", () => {
  test("is undefined with no skill", () => {
    expect(overall({})).toBeUndefined();
  });

  test("weighs practised skills over seeded ones", () => {
    const level = overall({
      grammar: { rating: 3.5, uncertainty: 0.2 },
      speaking: { rating: 1.5, uncertainty: 0.8 },
    }) as LevelState;
    expect(level.rating).toBeGreaterThan(3);
    expect(level.uncertainty).toBeLessThan(0.2);
  });

  test("equal certainty gives the plain mean", () => {
    const level = overall({
      grammar: { rating: 2, uncertainty: 0.5 },
      vocabulary: { rating: 3, uncertainty: 0.5 },
    }) as LevelState;
    expect(level.rating).toBeCloseTo(2.5);
  });
});
