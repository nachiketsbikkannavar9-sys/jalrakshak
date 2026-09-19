import { categoryFromScore, type LevelBasis, type RiskCategory } from "./index.js";

/**
 * PERSONAL FLOOD EXPOSURE — a *location* score layered on top of the station
 * hazard scale, deliberately sharing the SAME 5-tier vocabulary the rest of
 * the application uses (Normal/Watch/Warning/Severe/Critical via
 * `categoryFromScore`), so there is exactly ONE risk language in the product.
 *
 * - Station / regional hazard (`RiskCategory`) says "how worried are the
 *   gauges right now".
 * - Personal exposure (also `RiskCategory`, under the label PERSONAL EXPOSURE)
 *   says "how exposed is THIS point on the ground", given where the user is
 *   relative to the river, how high the ground is, how fast the water is
 *   rising, rain, and (where known) whether the point sits in a flood-zone.
 *
 * Model (starting weights per the design brief — see WEIGHTS):
 *
 *   PERSONAL EXPOSURE (0-100) =
 *       stationHazard × 0.35  (nearest station's own risk score, scaled)
 *     + elevation     × 0.20  (ground height RELATIVE to the current water
 *                              level: full exposure within 20 m of the water
 *                              line, tapering to ~0 by 100 m above)
 *     + proximity     × 0.20  (closer to the river gauge → higher; ~0 by 15 km)
 *     + trend         × 0.15  (rate of rise, normalised exactly like the
 *                              station risk engine: rise ÷ (range × divisor))
 *     + rainfall      × 0.10  (recent rainfall — the station engine's /100 mm)
 *
 * Rules baked into the engine (data-honesty):
 *  1. Never use elevation alone to decide the result. It is one weighted
 *     component among several, and only *relative* to the current water level.
 *  2. Never REDUCE the station hazard because a person happens to be on high
 *     ground — the station component is included additively, never negated.
 *  3. Missing signals drop OUT of the weighted average (the remaining weights
 *     are renormalised) instead of silently voting "neutral", so a lack of
 *     data slims the model rather than inflating it.
 *  4. Confusing box: exposure is an ESTIMATED MODELLED value, not a guarantee.
 *  5. Inundation: no flood-zone map exists in the app, so the component's
 *     weight is 0 and never claims to factor in. IF a zone is ever supplied,
 *     it does not add a small nudge — it dominates: the score is floored at 75.
 */

export type ExposureFactorKey =
  | "stationHazard"
  | "elevation"
  | "riverProximity"
  | "trendRateOfRise"
  | "rainfall"
  | "inundation";

// Reference values used to normalise each raw signal into a 0..1 factor.
// Tuned so LOWER elevation / closer proximity / faster rise read as EXPOSURE.
export const EXPOSURE_REFS = {
  /** Full elevation exposure when the ground is within this distance of the
   *  current water level; tapers linearly to nothing by headroomDeadM. */
  headroomFullM: 20,
  /** Elevation factor is flat (no elevation exposure) at/above this headroom. */
  headroomDeadM: 100,
  /** At/above this distance from the nearest gauge the proximity factor is 0. */
  proximityKm: 15,
  /** At/above this hourly rain the rain factor saturates (as the risk engine). */
  rainMm: 100,
} as const;

/**
 * A gauge farther than this from the point is NOT locally relevant — its water
 * level describes a different part of the river system, so comparing the
 * point's elevation against it would imply false precision. Beyond this
 * distance the elevation-vs-water-level and proximity comparisons are dropped
 * and the exposure is estimated from regional signals only (reduced
 * confidence). Named config, not a magic number.
 */
export const MAX_LOCAL_GAUGE_KM = 50;

export interface ExposureInput {
  /** Nearest station hazard score 0..100 (null when the gauge has no reading). */
  stationHazardScore: number | null;
  /** Nearest station latest water level (in the station's unit). */
  waterLevel: number | null;
  /** What the station level number means — needed to interpret elevation. */
  levelBasis: LevelBasis | null;
  /** Latest rate of rise (m/h, positive = rising). */
  rateOfRise: number | null;
  /** Station's level range (danger − normal) — reuses the risk engine's rise
   *  normalisation (rise ÷ (range × riseNormDivisor)) rather than reinventing. */
  stationLevelRange: number | null;
  /** Station's configured rise normalisation divisor (see riskEngine). */
  riseNormDivisor: number | null;
  /** Latest rainfall (mm/h). */
  rainfallMm: number | null;
  /** User ground elevation (m). */
  userElevationM: number | null;
  /** Great-circle distance from the user to the nearest station (km). */
  distanceKm: number | null;
  /** Whether the point is inside a known flood-zone (no flood-zone map → null). */
  inundated: boolean | null;
}

export interface ExposureFactor {
  key: ExposureFactorKey;
  label: string;
  /** Raw normalised signal (0..1). */
  factor: number;
  /** Weight actually applied after renormalisation (points of 100, 0 = absent). */
  weight: number;
  /** Short human criteria string describing what drove the factor. */
  criteria: string;
  available: boolean;
}

export interface ExposureResult {
  score: number;
  /** Same 5-tier category vocabulary as the station hazard system. */
  category: RiskCategory;
  /** True when the model actually has local signals to work with. */
  available: boolean;
  /** True when no monitored gauge is within MAX_LOCAL_GAUGE_KM of the point. */
  noNearbyGauge: boolean;
  factors: ExposureFactor[];
  /** Score is estimated/modelled — never a guarantee. */
  modelled: boolean;
  /** "high", or "reduced" when a local signal is missing (no nearby gauge,
   *  or elevation data unavailable) — displayed in the UI, never hidden. */
  confidence: "high" | "reduced";
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Design-brief starting weights (points of 100). Inundation has no model yet:
// its weight is 0 and it is omitted rather than silently voting neutral — the
// red-zone override (floor at 75) is the only path it can ever take.
const WEIGHTS: Record<ExposureFactorKey, number> = {
  stationHazard: 35,
  elevation: 20,
  riverProximity: 20,
  trendRateOfRise: 15,
  rainfall: 10,
  inundation: 0,
};

const LABELS: Record<ExposureFactorKey, string> = {
  stationHazard: "Gauge hazard (nearest river station)",
  elevation: "Ground elevation vs current water level",
  riverProximity: "Distance from the river gauge",
  trendRateOfRise: "How fast the water is rising",
  rainfall: "Recent rainfall",
  inundation: "Inside a known flood-zone",
};

export function computePersonalExposure(input: ExposureInput): ExposureResult {
  const raw: ExposureFactor[] = [];
  const push = (f: ExposureFactor) => raw.push(f);

  // A gauge only counts as a local reference if it is actually on the same
  // (river) system. Beyond MAX_LOCAL_GAUGE_KM its water level is not relevant
  // to this point, so elevation-vs-water-level and proximity/inundation
  // comparisons are all dropped and the point leans on regional signals only.
  const localGauge =
    input.distanceKm != null &&
    Number.isFinite(input.distanceKm) &&
    input.distanceKm <= MAX_LOCAL_GAUGE_KM;
  const noNearbyGauge = !localGauge;

  // 1. Station hazard — included additively, never reduced by anything below.
  //    When no gauge is local, this is treated as a weak REGIONAL signal only.
  push({
    key: "stationHazard",
    label: LABELS.stationHazard,
    factor: input.stationHazardScore == null ? 0.5 : clamp01(input.stationHazardScore / 100),
    weight: WEIGHTS.stationHazard,
    criteria:
      input.stationHazardScore == null
        ? "no reading yet at the nearest gauge"
        : input.distanceKm != null && input.distanceKm > MAX_LOCAL_GAUGE_KM
          ? `regional signal only · nearest gauge ${input.stationHazardScore}/100`
          : `nearest gauge ${input.stationHazardScore}/100`,
    available: input.stationHazardScore != null,
  });

  // 2. Elevation — always RELATIVE to the current water level (headroom), never
  //    "low elevation is dangerous" in the abstract. Requires a LOCAL gauge
  //    with a comparable water level, plus a ground elevation to compare.
  const comparableWaterLevel = input.waterLevel != null && input.levelBasis != null;
  if (localGauge && input.userElevationM != null && comparableWaterLevel) {
    const waterLevel = input.waterLevel as number;
    const headroom = input.userElevationM - waterLevel;
    const { headroomFullM, headroomDeadM } = EXPOSURE_REFS;
    const factor = clamp01((headroomDeadM - headroom) / Math.max(1e-6, headroomDeadM - headroomFullM));
    push({
      key: "elevation",
      label: LABELS.elevation,
      factor,
      weight: WEIGHTS.elevation,
      criteria:
        factor <= 0.001
          ? `ground ~${headroom.toFixed(1)} m above the water line — elevation exposure tapered off`
          : headroom < 0
            ? `ground ${Math.abs(headroom).toFixed(1)} m BELOW the current water level`
            : `ground ${headroom.toFixed(1)} m above the water line`,
      available: true,
    });
  }

  // 3. Proximity — only meaningful against a locally relevant gauge.
  if (input.distanceKm != null && localGauge) {
    push({
      key: "riverProximity",
      label: LABELS.riverProximity,
      factor: clamp01(1 - input.distanceKm / EXPOSURE_REFS.proximityKm),
      weight: WEIGHTS.riverProximity,
      criteria: `${input.distanceKm.toFixed(1)} km from the nearest river gauge`,
      available: true,
    });
  }

  // 4. Trend — reuse the station risk engine's rise normalisation exactly:
  //    riseNorm = clamp(rise ÷ (range × riseNormDivisor), 0, 1). Only rising
  //    water adds exposure; without the station's range/divisor we can't run
  //    the shared formula, so the term is omitted rather than guessed.
  if (
    input.rateOfRise != null &&
    input.stationLevelRange != null &&
    input.riseNormDivisor != null &&
    input.stationLevelRange > 0 &&
    input.riseNormDivisor > 0
  ) {
    const riseNorm = clamp01(Math.max(0, input.rateOfRise) / (input.stationLevelRange * input.riseNormDivisor));
    push({
      key: "trendRateOfRise",
      label: LABELS.trendRateOfRise,
      factor: riseNorm,
      weight: WEIGHTS.trendRateOfRise,
      criteria:
        input.rateOfRise > 0
          ? `rising ${input.rateOfRise.toFixed(2)} m/h`
          : "not rising right now",
      available: true,
    });
  }

  // 5. Rainfall — same normalisation as the risk engine (rainfallMm / 100).
  if (input.rainfallMm != null) {
    push({
      key: "rainfall",
      label: LABELS.rainfall,
      factor: clamp01(input.rainfallMm / EXPOSURE_REFS.rainMm),
      weight: WEIGHTS.rainfall,
      criteria: `${input.rainfallMm.toFixed(1)} mm in the last hour`,
      available: true,
    });
  }

  // 6. Inundation — no flood-zone map in the app yet, so weight 0; the slot
  //    exists so a zone, if ever supplied, dominates via the floor below.
  if (input.inundated != null && localGauge) {
    push({
      key: "inundation",
      label: LABELS.inundation,
      factor: input.inundated ? 1 : 0,
      weight: WEIGHTS.inundation,
      criteria: input.inundated ? "inside a known flood-zone" : "outside known flood-zones",
      available: true,
    });
  }

  const sumWeight = raw.reduce((s, f) => s + (f.available ? f.weight : 0), 0);
  const available = sumWeight > 0;

  if (!available) {
    return {
      score: 0,
      category: categoryFromScore(0),
      available: false,
      noNearbyGauge,
      factors: raw.map((f) => ({ ...f, weight: 0 })),
      modelled: true,
      confidence: "reduced",
    };
  }

  const renormalised = raw.map((f) => ({
    ...f,
    weight: f.available ? Math.round((f.weight / sumWeight) * 100) : 0,
  }));

  const weighted = renormalised.reduce(
    (s, f) => s + f.factor * f.weight,
    0
  );

  let score = Math.round(Math.max(0, Math.min(100, weighted)));

  // Red-zone override: being inside a known flood-zone dominates the other
  // factors — it floors the score at 75 rather than nudging it. (Unreachable
  // until a flood-zone source exists; kept as the spec'd behaviour.)
  if (input.inundated === true && localGauge) score = Math.max(score, 75);

  const elevationUsed = renormalised.some((f) => f.key === "elevation");
  return {
    score,
    category: categoryFromScore(score),
    available: true,
    noNearbyGauge,
    factors: renormalised,
    modelled: true,
    confidence: noNearbyGauge || !elevationUsed ? "reduced" : "high",
  };
}

export interface ExposureExplanation {
  factors: (ExposureFactor & { score: number; band: RiskCategory })[];
  whyThisExposure: string;
  honesty: string;
  /** True when the elevation component used a stage (gauge-based) comparison. */
  elevationGaugeRelative: boolean;
}

/** Build a plain-language, fact-driven explanation for a computed exposure. */
export function explainPersonalExposure(input: ExposureInput, display: {
  stationName: string;
  place: string;
  hazardCategory: RiskCategory | null;
}): ExposureExplanation {
  const result = computePersonalExposure(input);
  const factors = result.factors.map((f) => ({
    ...f,
    score: Math.round(f.factor * 100),
    band: categoryFromScore(Math.round(f.factor * 100)),
  }));

  // No locally relevant gauge: read differently from the normal explanation.
  // This is NOT the normal sentence plus a caveat — it is its own statement,
  // and it never invents an elevation-vs-water-level comparison.
  if (result.noNearbyGauge) {
    const near =
      input.distanceKm != null && Number.isFinite(input.distanceKm)
        ? ` (the nearest monitored gauge is ${display.stationName} at ${display.place}, ~${Math.round(input.distanceKm)} km away — beyond the ${MAX_LOCAL_GAUGE_KM} km local range)`
        : "";
    return {
      factors,
      whyThisExposure:
        `Personal exposure ${result.score}/100 (${result.category}). No monitored river or gauge within ${MAX_LOCAL_GAUGE_KM} km of this point${near} — the exposure is estimated from regional signals only and has reduced confidence. No headroom comparison against a distant gauge was made.`,
      honesty:
        "Reduced confidence: no locally relevant gauge, so no elevation-vs-water-level comparison is possible. This is a regional estimate, not a guarantee of safety or of flooding. Always follow NDRF/State authority instructions.",
      elevationGaugeRelative: false,
    };
  }

  const parts: string[] = [];

  if (input.distanceKm != null) {
    parts.push(
      typeof input.distanceKm === "number" && Number.isFinite(input.distanceKm)
        ? `this point is ~${input.distanceKm.toFixed(1)} km from the nearest gauge, ${display.stationName} at ${display.place}`
        : `this point's distance to the nearest gauge has not been measured`
    );
  }
  if (input.userElevationM != null) {
    parts.push(`ground elevation ~${input.userElevationM.toFixed(1)} m`);
    if (input.waterLevel != null && input.levelBasis != null) {
      const headroom = input.userElevationM - input.waterLevel;
      const datum =
        input.levelBasis === "RL" ? "above mean sea level" : "in the gauge's reference";
      parts.push(
        `the river is now at ${input.waterLevel} against the same reference, so the ground sits ~${headroom.toFixed(1)} m ${headroom >= 0 ? "above" : "below"} the water line`
      );
    }
  }
  if (display.hazardCategory != null && input.stationHazardScore != null) {
    parts.push(`the gauge hazard is ${display.hazardCategory} (${input.stationHazardScore}/100)`);
  }
  if (input.rateOfRise != null && input.rateOfRise > 0) {
    parts.push(`water is rising ~${input.rateOfRise.toFixed(2)} m/h`);
  }
  if (input.rainfallMm != null) {
    parts.push(`last hour saw ~${input.rainfallMm.toFixed(1)} mm of rain`);
  }

  const why = parts.length
    ? `Personal exposure ${result.score}/100 (${result.category}). At this point: ${parts.join("; ")}.`
    : `No local river or weather signal is available for this point yet, so this is a neutral estimate with no data driving it.`;

  // Item 7 caveat — higher terrain does not guarantee safety. Only when the
  // elevation component actually pulled the score down.
  const elevationFactor = result.factors.find((f) => f.key === "elevation")?.factor;
  const appended = elevationFactor != null && elevationFactor < 0.5
    ? " Higher terrain may reduce exposure, but does not guarantee safety — local drainage, nearby streams and extreme rainfall can still put higher ground at risk."
    : "";

  return {
    factors,
    whyThisExposure: why + appended,
    honesty:
      "Estimated, modelled exposure — a weighted combination of station hazard and location factors. Not a guarantee of safety or of flooding. Always follow NDRF/State authority instructions.",
    elevationGaugeRelative: input.levelBasis === "Depth" && input.waterLevel != null,
  };
}

export interface ExposureAlertAdvice {
  /** Location-specific call, layered ON TOP of the existing station alerts. */
  level: "none" | "advisory" | "warning";
  message: string;
}

/**
 * Combines station hazard + personal exposure for sites already under a
 * station-level alert. Layers on top of the existing authority workflow —
 * it never weakens or cancels a station alert.
 */
export function personalExposureAdvice(input: ExposureInput, display: {
  stationName: string;
  place: string;
  hazardCategory: RiskCategory | null;
}): ExposureAlertAdvice {
  const result = computePersonalExposure(input);
  const hazard = display.hazardCategory;

  if (!result.available || result.score === 0) {
    return {
      level: "none",
      message: `No usable local signal for this point yet — no location-specific warning can be issued. Station-level status at ${display.stationName} (${display.place}) remains in effect.`,
    };
  }

  // No locally relevant gauge: estimate from regional signals only, reduced
  // confidence. A site-specific warning cannot be justified on that basis.
  if (result.noNearbyGauge) {
    const near =
      input.distanceKm != null && Number.isFinite(input.distanceKm)
        ? `~${Math.round(input.distanceKm)} km away`
        : "at an unknown distance";
    return {
      level: "none",
      message: `No monitored river or gauge within ${MAX_LOCAL_GAUGE_KM} km of this point (nearest is ${display.stationName} at ${display.place}, ${near}) — personal exposure ${result.score}/100 (${result.category}) is estimated from regional signals only, with reduced confidence. No location-specific warning is warranted; station-level alerts at ${display.stationName} remain in effect.`,
    };
  }

  switch (result.category) {
    case "Critical":
      return {
        level: "warning",
        message: `SITE-SPECIFIC WARNING: this point has ${result.score}/100 personal exposure (Critical) while the ${display.stationName} gauge is ${hazard ?? "unreporting"}. This location warrants immediate, tailored attention regardless of the station average.`,
      };
    case "Severe":
      return {
        level: "warning",
        message: `SITE-SPECIFIC WARNING: ${result.score}/100 personal exposure (Severe) at this point near the ${display.stationName} gauge (${display.place}), with the gauge at ${hazard ?? "unreporting"}. Significant location-specific exposure — begin evacuation-readiness immediately.`,
      };
    case "Warning":
      return {
        level: "advisory",
        message: `Location advisory: ${result.score}/100 personal exposure (Warning) at this point near the ${display.stationName} gauge (${display.place}). Heightened personal exposure — prepare to move to higher ground and follow local authority readiness steps.`,
      };
    case "Watch":
      return {
        level: "advisory",
        message: `Monitor this point: ${result.score}/100 personal exposure (Watch) near the ${display.stationName} gauge (${display.place}). Not an immediate danger today, but conditions can change quickly with the station at ${hazard ?? "unreporting"}.`,
      };
    default: {
      // Normal exposure. Reconciliation: do NOT claim immediate danger for this
      // person just because the station is heavily alerted.
      const hazardNote =
        hazard && hazard !== "Normal"
          ? `the ${display.stationName} gauge is ${hazard} and all station-level warnings remain in force — follow authority instructions regardless of this point's exposure.`
          : `the ${display.stationName} gauge is ${hazard ?? "unreporting"} — follow authority instructions.`;
      return {
        level: "none",
        message: `This point has NORMAL personal exposure (${result.score}/100) today; no location-specific warning is warranted. However ${hazardNote}`,
      };
    }
  }
}