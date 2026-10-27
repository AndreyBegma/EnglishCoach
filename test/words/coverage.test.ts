import { describe, expect, test } from "bun:test";
import { BAND_SIZE, BANDS } from "../../src/sizetest/estimate";
import { type CoverageCurve, coverageAt, coveragePercent } from "../../src/words/coverage";

describe("coverage curve", () => {
  test("the committed curve spans the tested ranks and only rises", async () => {
    const curve = (await Bun.file(
      new URL("../../data/coverage/curve.json", import.meta.url),
    ).json()) as CoverageCurve;
    expect(curve.points[0]).toEqual([0, 0]);
    expect(curve.points.at(-1)?.[0]).toBe(BANDS * BAND_SIZE);
    for (let i = 1; i < curve.points.length; i++) {
      const [size, share] = curve.points[i] ?? [0, 0];
      const [prevSize, prevShare] = curve.points[i - 1] ?? [0, 0];
      expect(size).toBeGreaterThan(prevSize);
      expect(share).toBeGreaterThan(prevShare);
      expect(share).toBeLessThan(1);
    }
    expect(curve.rmse).toBeLessThan(0.02);
  });

  test("it agrees with the published headword coverage it was fitted to", () => {
    expect(coveragePercent(1000)).toBeGreaterThanOrEqual(79);
    expect(coveragePercent(1000)).toBeLessThanOrEqual(84);
    expect(coveragePercent(4000)).toBeGreaterThanOrEqual(92);
    expect(coveragePercent(4000)).toBeLessThanOrEqual(95);
    expect(coveragePercent(10_000)).toBeGreaterThanOrEqual(97);
  });

  test("interpolates between points and clamps at the ends", () => {
    const curve: CoverageCurve = {
      model: "test",
      rmse: 0,
      points: [
        [0, 0],
        [1000, 0.8],
        [2000, 0.9],
      ],
    };
    expect(coverageAt(500, curve)).toBeCloseTo(0.4);
    expect(coverageAt(1500, curve)).toBeCloseTo(0.85);
    expect(coverageAt(5000, curve)).toBe(0.9);
    expect(coverageAt(-1, curve)).toBe(0);
  });
});
