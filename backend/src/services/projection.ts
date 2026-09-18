import type { Projection } from "../../../shared/src/index.js";

/**
 * "Time to threshold" — forward-looking projection from the CURRENT rate of
 * rise. Explicitly a linear extrapolation (level_delta / rate), NOT a
 * hydrological model. Reuses the same rate floor shipped in the rate-of-rise
 * fix: a degenerate or missing rate yields no projection rather than a
 * garbage number.
 */
export const PROJECTION_HORIZON_H = 72;

export function projectThresholds(input: {
  level: number;
  warningLevel: number;
  dangerLevel: number;
  riseRateH: number | null;
}): Projection | null {
  const rate = input.riseRateH;
  // steady, falling, first reading, or degenerate gap → no projection
  if (rate == null || rate <= 0) return null;

  const cappedHours = (target: number): number | null => {
    if (target <= input.level) return null; // already past this threshold
    const h = (target - input.level) / rate;
    if (!Number.isFinite(h) || h > PROJECTION_HORIZON_H) return null;
    return h;
  };

  return {
    hoursToWarning: cappedHours(input.warningLevel),
    hoursToDanger: cappedHours(input.dangerLevel),
  };
}

/** Compact human form, e.g. "3h 20m" | "45m" | "12h". */
export function fmtProjectionHours(hours: number): string {
  if (!Number.isFinite(hours)) return "—";
  if (hours < 0.05) return "<1m";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 60) return `${h + 1}h`;
  return m >= 10 ? `${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m`;
}