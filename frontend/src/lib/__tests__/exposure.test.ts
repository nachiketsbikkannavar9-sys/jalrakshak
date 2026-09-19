import { describe, expect, it } from "vitest";
import {
  MAX_LOCAL_GAUGE_KM,
  categoryFromScore,
  computePersonalExposure,
  explainPersonalExposure,
  personalExposureAdvice,
  type ExposureInput,
} from "../../../../shared/src/index.js";

function input(overrides: Partial<ExposureInput>): ExposureInput {
  return {
    stationHazardScore: 40,
    waterLevel: 30,
    levelBasis: "Depth",
    rateOfRise: null,
    stationLevelRange: 10,
    riseNormDivisor: 0.06,
    rainfallMm: null,
    userElevationM: 60, // 30 m above the water line → elevation factor 0.875
    distanceKm: 4,
    inundated: null,
    ...overrides,
  };
}

describe("personal exposure engine (shared, pure)", () => {
  it("reuses the SAME 5-tier vocabulary as station hazard (brief item 2)", () => {
    // Exposure scores are bucketed by the shared categoryFromScore at exactly
    // the station cuts — a second, parallel risk vocabulary is NOT introduced.
    const cuts: [number, string][] = [
      [0, "Normal"],
      [27, "Normal"],
      [28, "Watch"],
      [49, "Watch"],
      [50, "Warning"],
      [69, "Warning"],
      [70, "Severe"],
      [87, "Severe"],
      [88, "Critical"],
      [100, "Critical"],
    ];
    for (const [score, cat] of cuts) expect(categoryFromScore(score)).toBe(cat);

    // ...and the engine actually lands on those shared categories.
    expect(computePersonalExposure(input({ stationHazardScore: 0, userElevationM: 200, distanceKm: 12 })).category).toBe("Normal");
    expect(computePersonalExposure(input({ stationHazardScore: 40 })).category).toBe("Warning"); // default case → Warning
    expect(computePersonalExposure(input({ stationHazardScore: 100, userElevationM: 20, distanceKm: 0, rateOfRise: 2, rainfallMm: 100 })).category).toBe("Critical");
  });

  it("is deterministic and uses the elevation RELATIVE to the water line", () => {
    const lowGround = computePersonalExposure(input({ userElevationM: 30 })); // headroom 0 → factor 1
    const highGround = computePersonalExposure(input({ userElevationM: 90 })); // headroom 60 → factor 0.5
    expect(lowGround).toEqual(computePersonalExposure(input({ userElevationM: 30 })));
    expect(lowGround.score).toBeGreaterThan(highGround.score);
    const elevLow = lowGround.factors.find((f) => f.key === "elevation");
    const elevHigh = highGround.factors.find((f) => f.key === "elevation");
    expect(elevLow?.factor).toBe(1); // within 20 m of the water line → full exposure
    expect(elevHigh?.factor).toBe(0.5); // 60 m above → half
  });

  it("never lets a person's elevation erase the station hazard", () => {
    // 50 km stays within the local range (elevation IS comparable), but the
    // ground sits ~470 m above the water line — so elevation reads 0 while the
    // severe station hazard must still count.
    const safeGround = computePersonalExposure(
      input({ stationHazardScore: 100, userElevationM: 500, waterLevel: 30, distanceKm: 50, rainfallMm: null, rateOfRise: null, inundated: null })
    );
    expect(safeGround.noNearbyGauge).toBe(false);
    const elev = safeGround.factors.find((f) => f.key === "elevation");
    const hazard = safeGround.factors.find((f) => f.key === "stationHazard");
    expect(elev?.factor).toBe(0); // 470 m above the water line → no elevation exposure
    expect(hazard?.factor).toBe(1); // hazard fully intact
    expect(safeGround.score).toBe(47); // hazard alone ≈ 35/75 renormalised → 47
    expect(safeGround.category).not.toBe("Normal");
  });

  it("missing signals drop out instead of voting neutral", () => {
    // distance 4 km → genuinely local; rainfall, rate, inundation are absent.
    const r = computePersonalExposure(input({ rainfallMm: null, rateOfRise: null, inundated: null }));
    // only available signals appear at all; missing ones are absent (not "neutral")
    expect(r.factors.map((f) => f.key)).toEqual(["stationHazard", "elevation", "riverProximity"]);
    expect(r.factors.find((f) => f.key === "rainfall")).toBeUndefined();
    expect(r.factors.find((f) => f.key === "trendRateOfRise")).toBeUndefined();
    // renormalised weights round to 35/75·100=47, 20/75·100=27, 27:
    // 0.4·47 + 0.875·27 + 0.7333·27 = 62.2 → 62
    expect(r.score).toBe(62);
  });

  it("elevation service outage drops the component, slims confidence, and never fabricates a value", () => {
    const r = computePersonalExposure(input({ userElevationM: null }));
    expect(r.factors.find((f) => f.key === "elevation")).toBeUndefined();
    expect(r.available).toBe(true); // other signals still drive it
    expect(r.confidence).toBe("reduced"); // brief item 13 — flagged, not hidden
    // hazard 0.4·64 + proximity 0.7333·36 (renormalised /55) = 52
    expect(r.score).toBe(52);
    expect(r.category).toBe(categoryFromScore(52));
  });

  it("all-clear point and fully exposed point land at the extremes", () => {
    const clear = computePersonalExposure(
      input({ stationHazardScore: 0, userElevationM: 200, waterLevel: 30, distanceKm: 12 })
    );
    expect(clear.score).toBe(5);
    expect(clear.category).toBe("Normal");

    const exposed = computePersonalExposure(
      input({ stationHazardScore: 100, userElevationM: 20, waterLevel: 30, distanceKm: 0, rateOfRise: 2, rainfallMm: 100 })
    );
    expect(exposed.score).toBe(100);
    expect(exposed.category).toBe("Critical");
  });

  it("closer to the river and faster rising water both raise exposure", () => {
    const near = computePersonalExposure(input({ distanceKm: 1 }));
    const far = computePersonalExposure(input({ distanceKm: 9 }));
    expect(near.score).toBeGreaterThan(far.score);

    const rising = computePersonalExposure(input({ rateOfRise: 2 }));
    const steady = computePersonalExposure(input({ rateOfRise: 0 }));
    expect(rising.score).toBeGreaterThan(steady.score);
  });

  it("two points on the SAME gauge land in different categories (brief items 2/6)", () => {
    // Same station hazard (100), both genuinely local; only the location differs.
    const low = computePersonalExposure(input({ stationHazardScore: 100, userElevationM: 25, distanceKm: 1 })); // headroom -5 → Critical
    const high = computePersonalExposure(input({ stationHazardScore: 100, userElevationM: 130, distanceKm: 4 })); // headroom 100 → Warning
    expect(low.category).toBe("Critical");
    expect(high.category).toBe("Warning");
    expect(low.score).toBeGreaterThan(high.score);
  });

  it("everything unknown yields a neutral, marked-unavailable baseline", () => {
    const r = computePersonalExposure(input({ stationHazardScore: null, waterLevel: null, levelBasis: null, distanceKm: null, userElevationM: null }));
    expect(r.available).toBe(false);
    expect(r.score).toBe(0);
    expect(r.category).toBe("Normal");
    expect(r.confidence).toBe("reduced");
  });
});

describe("no nearby gauge (honesty: beyond the local-range threshold)", () => {
  it("marks a point beyond MAX_LOCAL_GAUGE_KM as not-nearby, at and above the boundary", () => {
    expect(computePersonalExposure(input({ distanceKm: MAX_LOCAL_GAUGE_KM })).noNearbyGauge).toBe(false);
    expect(computePersonalExposure(input({ distanceKm: MAX_LOCAL_GAUGE_KM + 0.1 })).noNearbyGauge).toBe(true);
    expect(computePersonalExposure(input({ distanceKm: null })).noNearbyGauge).toBe(true);
  });

  it("drops the elevation-vs-water-level and proximity components and renomalises", () => {
    const far = computePersonalExposure(input({ distanceKm: 300, userElevationM: 60, waterLevel: 30, levelBasis: "Depth" }));
    expect(far.noNearbyGauge).toBe(true);
    expect(far.confidence).toBe("reduced");
    // elevation + proximity depend on the (non-local) gauge → absent entirely
    expect(far.factors.map((f) => f.key)).toEqual(["stationHazard"]);
    // only hazard is available → renomalised to 100% weight
    expect(far.score).toBe(40); // hazard 40/100

    // the otherwise-identical NEAR point keeps its extra signals
    const near = computePersonalExposure(input({ distanceKm: 8, userElevationM: 60, waterLevel: 30, levelBasis: "Depth" }));
    expect(near.noNearbyGauge).toBe(false);
    expect(near.confidence).toBe("high");
    expect(near.factors.some((f) => f.key === "elevation")).toBe(true);
    expect(near.factors.some((f) => f.key === "riverProximity")).toBe(true);
  });

  it("explanation reads as its own reduced-confidence statement and never invents a headroom figure", () => {
    const display = { stationName: "Godavari at Ambabal", place: "Chhattisgarh", hazardCategory: "Normal" as const };
    const e = explainPersonalExposure(input({ distanceKm: 512, userElevationM: 60, waterLevel: 30, levelBasis: "Depth" }), display);
    expect(e.whyThisExposure).toContain("No monitored river or gauge within");
    expect(e.whyThisExposure).toContain("512 km");
    expect(e.whyThisExposure).not.toContain("water line");
    expect(e.honesty).toContain("Reduced confidence");
    expect(e.elevationGaugeRelative).toBe(false);

    // and the near-point explanation still states the headroom factually
    const eNear = explainPersonalExposure(input({ distanceKm: 8, userElevationM: 60, waterLevel: 30, levelBasis: "Depth" }), display);
    expect(eNear.whyThisExposure).toContain("water line");
    expect(eNear.whyThisExposure).not.toBe(e.whyThisExposure);
  });

  it("advice never issues a location warning on regional-only, reduced-confidence estimates", () => {
    const display = { stationName: "Godavari at Ambabal", place: "Chhattisgarh", hazardCategory: "Warning" as const };
    const advice = personalExposureAdvice(input({ distanceKm: 512, stationHazardScore: 90, userElevationM: 60, waterLevel: 30, levelBasis: "Depth" }), display);
    expect(advice.level).toBe("none");
    expect(advice.message).toContain("reduced confidence");
    expect(advice.message).toContain("station-level alerts");
  });
});

describe("personal exposure explanation (factual, varies per location)", () => {
  it("builds a fact-driven sentence that differs between two locations", () => {
    const display = { stationName: "Ganga at Baisi", place: "Patna, Bihar", hazardCategory: "Warning" as const };
    const low = explainPersonalExposure(input({ userElevationM: 30, distanceKm: 0.4 }), display);
    const high = explainPersonalExposure(input({ userElevationM: 90, distanceKm: 7.5 }), display);
    expect(low.whyThisExposure).toContain("0.4 km");
    expect(high.whyThisExposure).toContain("7.5 km");
    expect(low.whyThisExposure).not.toBe(high.whyThisExposure);
    expect(low.whyThisExposure).toContain(display.stationName);
    expect(low.honesty).toContain("Not a guarantee");
  });

  it("says higher terrain may reduce exposure but never guarantees safety (brief item 7)", () => {
    const display = { stationName: "Mahanadi at Naraj", place: "Cuttack", hazardCategory: "Severe" as const };
    const e = explainPersonalExposure(input({ userElevationM: 120, waterLevel: 30 }), display); // 90 m above the water line
    expect(e.whyThisExposure).toContain("Higher terrain may reduce exposure, but does not guarantee safety");
  });

  it("labels a depth-gauge elevation comparison as gauge-relative", () => {
    const e = explainPersonalExposure(input({ levelBasis: "Depth" }), { stationName: "NH15", place: "Belagavi", hazardCategory: "Watch" });
    expect(e.elevationGaugeRelative).toBe(true);
  });
});

describe("personal exposure alert advice (layers on top; never overstates)", () => {
  it("CRITICAL exposure near an alerted gauge → site-specific warning", () => {
    const advice = personalExposureAdvice(
      input({ stationHazardScore: 100, userElevationM: 20, waterLevel: 30, distanceKm: 0 }),
      { stationName: "Mahanadi at Naraj", place: "Cuttack", hazardCategory: "Warning" }
    );
    expect(advice.level).toBe("warning");
    expect(advice.message).toContain("SITE-SPECIFIC WARNING");
  });

  it("Warning-level personal exposure → advisory, not an overblown warning", () => {
    const advice = personalExposureAdvice(
      input({ stationHazardScore: 50, userElevationM: 40, waterLevel: 30, distanceKm: 5 }),
      { stationName: "Mahanadi at Naraj", place: "Cuttack", hazardCategory: "Severe" }
    );
    expect(computePersonalExposure(input({ stationHazardScore: 50, userElevationM: 40, distanceKm: 5 })).category).toBe("Warning");
    expect(advice.level).toBe("advisory");
    expect(advice.message).not.toContain("SITE-SPECIFIC WARNING");
  });

  it("Station SEVERE + Personal NORMAL does NOT claim immediate danger to that person — but keeps the station alert alive", () => {
    // All of this person's situation signals are benign (far from the river,
    // high above the water line, flat trend, no rain) — the station is severe.
    const advice = personalExposureAdvice(
      input({ stationHazardScore: 40, userElevationM: 200, waterLevel: 30, distanceKm: 15, rateOfRise: 0, rainfallMm: 0 }),
      { stationName: "Mahanadi at Naraj", place: "Cuttack", hazardCategory: "Severe" }
    );
    expect(computePersonalExposure(input({ stationHazardScore: 40, userElevationM: 200, waterLevel: 30, distanceKm: 15, rateOfRise: 0, rainfallMm: 0 })).category).toBe("Normal");
    expect(advice.level).toBe("none");
    expect(advice.message).toContain("NORMAL personal exposure");
    expect(advice.message).toContain("Severe");
    expect(advice.message).not.toContain("immediate danger");
  });
});