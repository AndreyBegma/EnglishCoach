import { join } from "node:path";
import curveJson from "../../data/coverage/curve.json";

/** Built by `scripts/build-coverage.ts`; see there for the model behind the numbers. */
export const COVERAGE_CURVE_PATH = join(import.meta.dir, "../../data/coverage/curve.json");

export interface CoverageCurve {
  model: string;
  /** Root-mean-square error of the model against its anchors. */
  rmse: number;
  /** `[words known, share of running text covered]`, ascending, starting at `[0, 0]`. */
  points: [number, number][];
}

const CURVE = curveJson as CoverageCurve;

/**
 * The share (0..1) of everyday running text covered by the `size` most frequent words, linearly
 * interpolated on the curve; sizes past its end read as its last point.
 */
export function coverageAt(size: number, curve: CoverageCurve = CURVE): number {
  const { points } = curve;
  const last = points[points.length - 1];
  if (!last || size <= 0) return 0;
  if (size >= last[0]) return last[1];
  for (let index = 1; index < points.length; index++) {
    const upper = points[index];
    const lower = points[index - 1];
    if (!upper || !lower || size > upper[0]) continue;
    const span = upper[0] - lower[0];
    return lower[1] + ((upper[1] - lower[1]) * (size - lower[0])) / span;
  }
  return last[1];
}

/** Coverage as a whole percent, for display ("~95%"). */
export const coveragePercent = (size: number, curve?: CoverageCurve) =>
  Math.round(coverageAt(size, curve) * 100);
