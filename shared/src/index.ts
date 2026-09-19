/**
 * Risk category. "No data" is not a score tier — it marks a station with zero
 * ingested readings yet (distinct from a genuinely low-risk "Normal").
 * categoryFromScore never returns it; only consumers whose station has
 * `latest === null` use it for the neutral presentation.
 */
export type RiskCategory = "Normal" | "Watch" | "Warning" | "Severe" | "Critical" | "No data";

export const CATEGORY_BOUNDS: { cat: RiskCategory; min: number; max: number }[] = [
  { cat: "Normal", min: 0, max: 27 },
  { cat: "Watch", min: 28, max: 49 },
  { cat: "Warning", min: 50, max: 69 },
  { cat: "Severe", min: 70, max: 87 },
  { cat: "Critical", min: 88, max: 100 },
];

export function categoryFromScore(score: number): RiskCategory {
  if (score >= 88) return "Critical";
  if (score >= 70) return "Severe";
  if (score >= 50) return "Warning";
  if (score >= 28) return "Watch";
  return "Normal";
}

export function riskScoreFromParts(parts: {
  proximity: number;
  riseNorm: number;
  rainfallNorm: number;
  weights: { proximity: number; rise: number; rain: number };
}): number {
  const s =
    parts.proximity * parts.weights.proximity +
    parts.riseNorm * parts.weights.rise +
    parts.rainfallNorm * parts.weights.rain;
  return Math.round(Math.max(0, Math.min(100, s)));
}

/**
 * Rate-of-rise plausibility, symmetric in BOTH directions (rise and fall).
 * Two guards, both shared with every display path so a floored rate can never
 * render as a huge number:
 *  1. MIN_RATE_GAP_MS (backend) — a short gap between readings cannot describe
 *     a rate at all (near-zero Δt division); it yields no rate, not "±300 m/h".
 *  2. MAX_ABS_RATE_H — even across a gap above the floor, a stage change this
 *     violent in a single step is not credible river telemetry (it is a spike /
 *     resync artifact, not a flood). It yields no rate in either direction.
 * A real sharp flood crest reads ~1–6 m/h (e.g. NWDP hourly samples); anything
 * above MAX_ABS_RATE_H is omitted rather than shouted.
 */
export const MAX_ABS_RATE_H = 12; // m/h — credible river stage change per hour

/** null (omit) any rate whose magnitude is not credible telemetry. */
export function sanitizeRateOfRise(rateOfRise: number | null | undefined): number | null {
  if (rateOfRise == null || !Number.isFinite(rateOfRise)) return null;
  return Math.abs(rateOfRise) > MAX_ABS_RATE_H ? null : rateOfRise;
}

export type ScoreContributionKey = "water_level_and_capacity" | "trend_rate_of_rise" | "rainfall";

export interface ScoreContribution {
  key: ScoreContributionKey;
  label: string;
  /** the raw normalised factor (0..1) captured at this station */
  normalized: number;
  /** its weight in the formula (points on the 0..100 scale, e.g. 60/30/10) */
  weight: number;
  /** normalized × weight — how many points this driver stacked up */
  weightedAmount: number;
  /** share of the final score this driver explains (%), rounded */
  percentOfScore: number;
}

export interface RiskExplanation {
  score: number;
  category: RiskCategory;
  contributions: ScoreContribution[];
  /** One honest sentence in plain language — one source of truth, no fake "AI". */
  whyThisScore: string;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function driverPhrase(key: ScoreContributionKey, norm: number): string {
  if (key === "water_level_and_capacity") {
    if (norm >= 0.75) return "the water level sits very close to the danger capacity";
    if (norm >= 0.5) return "the water level is high relative to the danger capacity";
    if (norm >= 0.25) return "the water level is above the normal baseline but still has margin";
    return "the water level is at or under its normal baseline";
  }
  if (key === "trend_rate_of_rise") {
    if (norm >= 0.7) return "the level is rising fast";
    if (norm >= 0.4) return "the level is rising steadily";
    if (norm >= 0.15) return "a slow rise is underway";
    return "there is no strong rising trend";
  }
  if (norm >= 0.6) return "recent rainfall is heavy";
  if (norm >= 0.25) return "some recent rain is factored in";
  return "little recent rainfall";
}

/**
 * Explains a score in honest, component-wise terms. Consumers can show the
 * numbers (contributions) or just the sentence (whyThisScore). Pure, so it is
 * shared by the API, the UI and the automated tests.
 */
export function explainRisk(parts: {
  proximity: number;
  riseNorm: number;
  rainfallNorm: number;
  weights: { proximity: number; rise: number; rain: number };
}): RiskExplanation {
  const rows: { key: ScoreContributionKey; label: string; norm: number; weight: number }[] = [
    {
      key: "water_level_and_capacity",
      label: "Water level vs danger capacity",
      norm: parts.proximity,
      weight: parts.weights.proximity,
    },
    { key: "trend_rate_of_rise", label: "Trend / rate of rise", norm: parts.riseNorm, weight: parts.weights.rise },
    { key: "rainfall", label: "Recent rainfall", norm: parts.rainfallNorm, weight: parts.weights.rain },
  ];
  const totalRaw = rows.reduce((s, r) => s + r.norm * r.weight, 0);
  const score = riskScoreFromParts({
    proximity: parts.proximity,
    riseNorm: parts.riseNorm,
    rainfallNorm: parts.rainfallNorm,
    weights: parts.weights,
  });
  const category = categoryFromScore(score);

  const contributions: ScoreContribution[] = rows.map((r) => {
    const weightedAmount = r.norm * r.weight;
    return {
      key: r.key,
      label: r.label,
      normalized: round3(r.norm),
      weight: r.weight,
      weightedAmount: round3(weightedAmount),
      percentOfScore: totalRaw > 0 ? Math.round((weightedAmount / totalRaw) * 100) : 0,
    };
  });

  let why: string;
  if (totalRaw <= 0.001) {
    why = `Risk score ${score}/100 (${category}). The gauge reads near its baseline with no meaningful rising trend — almost nothing is pushing the score up right now.`;
  } else {
    const drivers = [...contributions].sort((a, b) => b.weightedAmount - a.weightedAmount).filter((c) => c.weightedAmount > 0.02);
    const top = drivers.length ? drivers[0] : contributions[0];
    const second = drivers.length > 1 ? drivers[1] : undefined;
    const head =
      second && second.weightedAmount >= 0.06
        ? `${driverPhrase(top.key, top.normalized)}, and ${driverPhrase(second.key, second.normalized)}`
        : driverPhrase(top.key, top.normalized);
    why = `Risk score ${score}/100 (${category}). ${head[0].toUpperCase() + head.slice(1)} — that is what is driving this station's score.`;
  }

  return { score, category, contributions, whyThisScore: why };
}

export type StationKind = "River" | "Dam" | "Lake";

export interface StationRiskConfig {
  weightProximity: number;
  weightRise: number;
  weightRain: number;
  riseNormDivisor: number;
  rainfallEnabled: boolean;
  alertCooldownMin: number;
}

export interface Projection {
  /** Hours until warning level at current rate (null when not rising, past the
   *  threshold, or beyond the display horizon). Linear extrapolation only. */
  hoursToWarning: number | null;
  hoursToDanger: number | null;
}

export interface LatestReading {
  level: number;
  unit: string;
  riskScore: number;
  category: RiskCategory;
  rateOfRise: number | null; // metres / hour, positive = rising
  rainfallMm: number | null;
  observedAt: string; // ISO
  projection: Projection | null; // null when steady/falling/no data
  /** Explainable why: component breakdown + plain-language sentence. */
  explain: RiskExplanation;
}

export type LevelBasis = "RL" | "Depth";

export interface StationDTO {
  id: string;
  externalId: string | null;
  source: string;
  sourceLabel: string;
  simulated: boolean;
  name: string;
  kind: StationKind;
  place: string;
  /** State/region this gauge monitors (Assam, Bihar, …, "United Kingdom", null). */
  region: string | null;
  lat: number;
  lng: number;
  unit: string;
  /** What the level number means: reduced level (elevation above mean sea
   *  level, e.g. Ambabal's ~535 m) vs a depth/stage gauge reading. */
  levelBasis: LevelBasis | null;
  normalLevel: number;
  warningLevel: number;
  dangerLevel: number;
  riskConfig: StationRiskConfig;
  latest: LatestReading | null;
  recent: { t: number; v: number }[]; // sparkline, oldest -> newest
}

export interface NationalStats {
  nationalIndex: number; // mean of latest riskScore across stations
  totalStations: number;
  withReadings: number;
  byCategory: Record<RiskCategory, number>;
  updatedAt: string | null;
}

export interface AlertDTO {
  id: string;
  stationId: string;
  stationName: string;
  place: string;
  kind: string;
  riskScore: number;
  category: RiskCategory;
  channel: "sms" | "email";
  sentTo: string;
  body: string;
  delivered: boolean;
  /** How we tried to send: "resend" | "twilio" | "console-demo". */
  deliveredVia: string;
  /** Honest delivery result: "delivered" | "logged-console" | "failed". */
  deliveryState: "delivered" | "logged-console" | "failed";
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  /** Threshold context from the station at alert time (what the numbers mean). */
  level: number | null;
  unit: string | null;
  normalLevel: number | null;
  warningLevel: number | null;
  dangerLevel: number | null;
  rateOfRise: number | null;
  projectionHoursToWarning: number | null;
  projectionHoursToDanger: number | null;
}

export interface ContactDTO {
  name: string;
  role: string;
  channel: "sms" | "email";
  address: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  displayName: string;
  /** Regions/states the account may action (e.g. ["Assam"]). Empty + national role = nationwide. */
  jurisdictionRegions: string[];
  /** Explicit station ids in scope (region or station-level jurisdiction). */
  jurisdictionStationIds: string[];
}

// ── Multi-agency jurisdiction ───────────────────────────────────────────────
// Same logic runs server-side (route gating) and client-side (console views),
// so it lives in shared. `role === "admin"` (or a `"*"` region entry) = national
// scope: everything is visible and actionable.

const NATIONAL_ROLE = "admin";
export const SCOPE_ALL = "*";

export type ScopeUser = Pick<AuthUser, "role" | "jurisdictionRegions" | "jurisdictionStationIds">;

export function isNationalScope(u: ScopeUser | null | undefined): boolean {
  if (!u) return true; // anonymous public views show everything, read-only
  if (u.role === NATIONAL_ROLE) return true;
  return (u.jurisdictionRegions ?? []).includes(SCOPE_ALL);
}

/** Is a station inside an authority account's jurisdiction? */
export function stationInScope(
  u: ScopeUser | null | undefined,
  station: { id: string; region?: string | null }
): boolean {
  if (isNationalScope(u)) return true;
  const regions = u?.jurisdictionRegions ?? [];
  const stationIds = u?.jurisdictionStationIds ?? [];
  if (station.region && regions.includes(station.region)) return true;
  if (stationIds.includes(station.id)) return true;
  return false;
}

/** Short human label for an account's scope, e.g. "Assam" or "national". */
export function scopeLabel(u: ScopeUser | null | undefined): string {
  if (isNationalScope(u)) return "national";
  const regions = u?.jurisdictionRegions ?? [];
  const ids = u?.jurisdictionStationIds ?? [];
  if (!regions.length && !ids.length) return "none";
  const parts = [...regions];
  if (ids.length) parts.push(`${ids.length} station${ids.length === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export interface HistoryPoint {
  t: number;
  v: number;
  riskScore: number | null;
  category: RiskCategory;
}

export interface IntervalStats {
  label: string;
  rateOfRise: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  current: number | null;
  category: RiskCategory | null;
}

export const SHOW_SIMULATED = true;

// ── Citizen-facing guidance (shared by the public UI + the email notifier) ──
export const CATEGORY_GUIDANCE: Record<RiskCategory, { title: string; action: string }> = {
  Normal: {
    title: "Rivers at usual levels",
    action: "No action needed. Continue to monitor district announcements during heavy rains.",
  },
  Watch: {
    title: "Levels rising — be alert",
    action: "Stay away from riverbanks, low-lying bridges and causeways. Note evacuation routes. Check advisories twice a day.",
  },
  Warning: {
    title: "Flood risk — stay ready",
    action: "Avoid riverbanks and low-lying areas. Stock essentials, charge devices, keep documents ready. Heed local authority guidance.",
  },
  Severe: {
    title: "Significant flooding possible",
    action: "Move valuables to higher ground, keep family informed of a meeting point, and be prepared to evacuate quickly on instruction.",
  },
  Critical: {
    title: "Imminent/severe flooding",
    action: "Follow evacuation orders immediately. Do not walk or drive through floodwater. Move to the highest safe place.",
  },
  "No data": {
    title: "No recent reading at this gauge",
    action: "The gauge has not reported recently. Check the nearest neighbouring stations and rely on local authorities for the latest.",
  },
};

// ── Personal flood exposure (location-level, distinct from station hazard) ──
export * from "./personalExposure.js";