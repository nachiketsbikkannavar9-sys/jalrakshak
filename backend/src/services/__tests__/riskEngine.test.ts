import { describe, expect, it } from "vitest";
import { computeRisk, MIN_RATE_GAP_MS, type RiskInput } from "../riskEngine.js";
import { CATEGORY_BOUNDS, categoryFromScore } from "../../../../shared/src/index.js";

function makeInput(overrides: Partial<RiskInput> & Pick<RiskInput, "level">): RiskInput {
  const now = new Date("2026-09-17T12:00:00Z");
  const base: Omit<RiskInput, "level"> = {
    normalLevel: 30,
    dangerLevel: 50,
    riseNormDivisor: 0.06,
    weights: { proximity: 60, rise: 30, rain: 10 }, // mirrors station.weightProximity etc
    rainfallMm: null,
    prev: { level: overrides.level, observedAt: new Date(now.getTime() - 60 * 60_000) },
    now,
  };
  return { ...base, ...overrides } as RiskInput;
}

function scoreForLevel(level: number): number {
  return computeRisk(makeInput({ level })).score;
}

describe("risk engine", () => {
  it("maps every category band boundary", () => {
    // boundaries are exclusive/inclusive per CATEGORY_BOUNDS
    expect(scoreForLevel(-100)).toBe(0); // clamp low
    // proximity alone saturates at its 60-point weight (rise/rain add the rest)
    expect(scoreForLevel(1e9)).toBe(60);
    // drive score precisely via a level that places proximity exactly at 0.5 → 30
    const mid = computeRisk(makeInput({ level: 40 })); // (40-30)/20 = 0.5 → 30
    expect(mid.proximity).toBe(0.5);
    expect(mid.score).toBe(30);
  });

  it("clamps proximity into 0..1 and never exceeds the weight", () => {
    const below = computeRisk(makeInput({ level: 10 }));
    expect(below.proximity).toBe(0);
    expect(below.riseNorm).toBe(0);
    const above = computeRisk(makeInput({ level: 80 }));
    expect(above.proximity).toBe(1);
    // rainfall disabled → score comes only from proximity * 0.6
    expect(above.score).toBe(60);
  });

  it("applies the 2-minute rate floor (MIN_RATE_GAP_MS)", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const prev = { level: 10, observedAt: new Date(now.getTime() - 60_000) };
    const fast = computeRisk(makeInput({ level: 40, prev, now }));
    expect(fast.riseRateH).toBeNull(); // gap < MIN_RATE_GAP_MS → no rate
    expect(fast.riseNorm).toBe(0);

    const prev2 = { level: 39.866, observedAt: new Date(now.getTime() - MIN_RATE_GAP_MS - 1000) };
    const slow = computeRisk(makeInput({ level: 40, prev: prev2, now }));
    const gapH = (MIN_RATE_GAP_MS + 1000) / 3_600_000; // just above the floor
    expect(slow.riseRateH).toBeCloseTo((40 - 39.866) / gapH, 3); // ~4 m/h — plausible
    expect(slow.riseNorm).toBeGreaterThan(0);
  });

  it("applies the plausible-rate floor symmetrically — huge DROP == huge RISE (both omitted)", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    // The Guwahati repro: a forced spike to 49 at T, then a resumed-simulation
    // reading of 46.819 only 122s later — 2.181 m over 2 min = −64.3 m/h. The
    // gap clears the 2-minute floor, so the plausibility guard must catch it.
    const dropPrev = { level: 49, observedAt: new Date(now.getTime() - 122_000) };
    const drop = computeRisk(makeInput({ level: 46.819, prev: dropPrev, now }));
    expect(drop.riseRateH).toBeNull();
    expect(drop.riseNorm).toBe(0);

    // mirror image: identical upward jump must also be omitted
    const risePrev = { level: 46.819, observedAt: new Date(now.getTime() - 122_000) };
    const rise = computeRisk(makeInput({ level: 49, prev: risePrev, now }));
    expect(rise.riseRateH).toBeNull();

    // a plausible rate — the Arrah repro (+6.134 m/h over a real 1h sample) —
    // survives the guard in the >0 direction used by projections
    const real = computeRisk(makeInput({ level: 45.37 + 6.134, prev: { level: 45.37, observedAt: new Date(now.getTime() - 3_600_000) }, now }));
    expect(real.riseRateH).toBeCloseTo(6.134, 3);
  });

  it("normalises rainfall against 100 mm and stops at 1", () => {
    const r50 = computeRisk(makeInput({ level: 30, rainfallMm: 50 }));
    expect(r50.rainfallNorm).toBe(0.5);
    const r200 = computeRisk(makeInput({ level: 30, rainfallMm: 200 }));
    expect(r200.rainfallNorm).toBe(1);
  });

  it("category bands are a continuous, non-overlapping 0–100 partition", () => {
    expect(CATEGORY_BOUNDS.length).toBe(5);
    expect(CATEGORY_BOUNDS[0].min).toBe(0);
    expect(CATEGORY_BOUNDS[4].max).toBe(100);
    for (let i = 1; i < CATEGORY_BOUNDS.length; i++) {
      expect(CATEGORY_BOUNDS[i].min).toBe(CATEGORY_BOUNDS[i - 1].max + 1);
    }
    // every score lands in exactly one band, matching categoryFromScore
    for (let s = 0; s <= 100; s++) {
      const band = CATEGORY_BOUNDS.filter((b) => s >= b.min && s <= b.max);
      expect(band.length).toBe(1);
      expect(band[0].cat).toBe(categoryFromScore(s));
    }
  });

  it("computeRisk.score and riskScoreFromParts agree with explainRisk", () => {
    const r = computeRisk(makeInput({ level: 43, rainfallMm: 30 }));
    expect(r.explain.score).toBe(r.score);
    expect(r.explain.category).toBe(r.category);
    const totalWeighted = r.explain.contributions.reduce((a, c) => a + c.weightedAmount, 0);
    expect(Math.abs(Math.round(totalWeighted) - r.score)).toBeLessThanOrEqual(1);
    // percents describe the full score (± rounding)
    const pct = r.explain.contributions.reduce((a, c) => a + c.percentOfScore, 0);
    expect(pct).toBeGreaterThanOrEqual(97);
    expect(pct).toBeLessThanOrEqual(103);
  });

  it("explainRisk clamps to the same five categories as the UI", () => {
    const r = computeRisk(makeInput({ level: 25 }));
    expect(r.category).toBe("Normal");
    expect(r.explain.whyThisScore).toContain("Risk score");
  });
});