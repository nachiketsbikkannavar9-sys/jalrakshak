import {
  categoryFromScore,
  explainRisk,
  sanitizeRateOfRise,
  type RiskCategory,
  type RiskExplanation,
} from "../../../shared/src/index.js";

export interface RiskInput {
  level: number;
  normalLevel: number;
  dangerLevel: number;
  riseNormDivisor: number;
  weights: { proximity: number; rise: number; rain: number };
  rainfallMm: number | null;
  prev?: { level: number; observedAt: Date };
  now: Date;
}

export interface RiskResult {
  score: number;
  category: RiskCategory;
  proximity: number;
  riseNorm: number;
  rainfallNorm: number;
  riseRateH: number | null; // metres / hour (positive = rising)
  explain: RiskExplanation;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Minimum gap between consecutive readings before a rate-of-rise is
 * meaningful. Instant/forced jumps (e.g. the admin "spike" tool) can leave
 * seconds between readings, which would otherwise divide a big delta by a
 * near-zero Δt and print "rise +300 m/h". Below the floor we report no rate,
 * and the rise term contributes 0 to the score — proximity alone stays enough
 * to flag a real jump.
 */
export const MIN_RATE_GAP_MS = 2 * 60_000; // 2 minutes

/**
 * Risk engine — server-side, reproducible from stored readings.
 *   proximity   (0..1) how far between normal and danger level we are      ×60
 *   riseNorm    (0..1) rate-of-rise, normalised by a per-station divisor ×30
 *   rainfall    (0..1) forecast rain, normalised /100mm                    ×10
 * Weights and the rise divisor are stored per station (a dam behaves
 * differently from a flashy hill river — see DB Station.* columns).
 */
export function computeRisk(input: RiskInput): RiskResult {
  const range = Math.max(1e-6, input.dangerLevel - input.normalLevel);
  const proximity = clamp((input.level - input.normalLevel) / range, 0, 1);

  // The 2-minute gap floor applies symmetrically — rises AND falls. A big
  // delta across a gap only just above the floor is still a near-zero Δt
  // division (it prints "−64 m/h" after an instant drop), so whatever the
  // raw rate magnitude, an implausible result is omitted in both directions.
  let riseRateH: number | null = null;
  if (input.prev && input.now.getTime() - input.prev.observedAt.getTime() >= MIN_RATE_GAP_MS) {
    const dH = (input.now.getTime() - input.prev.observedAt.getTime()) / 3_600_000;
    if (dH > 0) {
      const raw = (input.level - input.prev.level) / dH;
      riseRateH = sanitizeRateOfRise(Math.round(raw * 1000) / 1000);
    }
  }
  const riseNorm = clamp((riseRateH ?? 0) / (range * input.riseNormDivisor), 0, 1);
  const rainfallNorm = clamp((input.rainfallMm ?? 0) / 100, 0, 1);

  const explain = explainRisk({ proximity, riseNorm, rainfallNorm, weights: input.weights });
  const score = explain.score;

  return {
    score,
    category: categoryFromScore(score),
    proximity,
    riseNorm,
    rainfallNorm,
    riseRateH:
      riseRateH == null ? null : Math.round(riseRateH * 1000) / 1000,
    explain,
  };
}