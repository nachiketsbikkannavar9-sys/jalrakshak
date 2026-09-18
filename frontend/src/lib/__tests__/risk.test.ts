import { describe, expect, it } from "vitest";
import { CATEGORY_ORDER, CATEGORY_META, categoryOf, PUBLIC_GUIDANCE } from "../risk";
import { CATEGORY_BOUNDS, CATEGORY_GUIDANCE, explainRisk, categoryFromScore } from "../../../../shared/src/index.js";

describe("risk lib · category meta", () => {
  it("has meta for every category the UI can render (order + no-data)", () => {
    for (const c of CATEGORY_ORDER) expect(CATEGORY_META[c]).toBeTruthy();
    expect(CATEGORY_META["No data"]).toBeTruthy();
  });

  it("PUBLIC_GUIDANCE is the single shared source of truth", () => {
    expect(PUBLIC_GUIDANCE).toBe(CATEGORY_GUIDANCE);
  });

  it("frontend categoryOf agrees with the shared categoryFromScore", () => {
    for (let s = 0; s <= 100; s++) expect(categoryOf(s)).toBe(categoryFromScore(s));
  });
});

describe("risk lib · explainable score (pure, shared)", () => {
  it("breaks the score into drivers that add back up", () => {
    const e = explainRisk({ proximity: 0.65, riseNorm: 0.4, rainfallNorm: 0.3, weights: { proximity: 60, rise: 30, rain: 10 } });
    expect(e.score).toBe(54); // 0.39 + 0.12 + 0.03
    expect(e.category).toBe("Warning");
    expect(e.contributions).toHaveLength(3);
    expect(e.contributions[0].key).toBe("water_level_and_capacity");
    expect(e.contributions.reduce((a, c) => a + c.weightedAmount, 0)).toBeCloseTo(54, 5);
    expect(e.whyThisScore).toContain("Risk score 54/100");
  });

  it("explains a zero-score gauge honestly (no invented risk)", () => {
    const e = explainRisk({ proximity: 0, riseNorm: 0, rainfallNorm: 0, weights: { proximity: 60, rise: 30, rain: 10 } });
    expect(e.score).toBe(0);
    expect(e.category).toBe("Normal");
    expect(e.whyThisScore).toContain("near its baseline");
    expect(e.contributions.every((c) => c.percentOfScore === 0)).toBe(true);
  });

  it("CATEGORY_BOUNDS partition 0–100 continuously", () => {
    expect(CATEGORY_BOUNDS[0].min).toBe(0);
    expect(CATEGORY_BOUNDS[CATEGORY_BOUNDS.length - 1].max).toBe(100);
    for (let i = 1; i < CATEGORY_BOUNDS.length; i++) {
      expect(CATEGORY_BOUNDS[i].min).toBe(CATEGORY_BOUNDS[i - 1].max + 1);
    }
  });
});