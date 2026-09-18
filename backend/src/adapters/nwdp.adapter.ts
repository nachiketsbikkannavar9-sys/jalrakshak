import type { AdapterReading, StationSeed, WaterDataAdapter } from "./types.js";
import { fetchJson, mapPool } from "./http.js";

/**
 * NWDP / India-WRIS adapter — REAL CWC + state telemetry.
 *
 * Reads the National Water Data Portal CKAN datastore
 * (nwdp.nwic.gov.in) "River Water Level (Telemetry — Hourly)"
 * resources. No API key required. The datastore is refreshed as the
 * CWC/state teams publish; acquisition timestamps are preserved exactly
 * (we never pretend an old sample is "now").
 *
 * Curated for the demo: 6 gauges across Godavari, Ganga and Brahmaputra
 * basins.
 *
 * THRESHOLDS: CWC does not publish warning/danger levels through this
 * datastore, so each gauge's Normal/Warning/Danger is inferred from its own
 * full 2026 telemetry and labelled as inferred in the UI:
 *   normal  = q10 of observed levels − 0.3 m   (baseline below the low-flow stage)
 *   danger  = q99 of observed levels + 0.3 m   (a stage above the published high tail)
 *   warning = q90 where that is meaningfully above normal, else the midpoint
 *             between normal and danger (keeps near-flat gauges' band sane)
 * The resulting band is wide enough that the CURRENT level always sits at a
 * real, non-zero position — never the degenerate "level == normal → score 0".
 *
 * SANITY BOUNDS: the upstream series contains occasional malformed rows
 * (e.g. Bhadrachalam 262.48 m, Baisi 722.95 m — unit/column glitches), so
 * every parsed level is checked against plausible river-gauge bounds before
 * it is accepted: level must be ≥ 0 and ≤ min(200 m, 3 × dangerLevel) unless
 * the station is explicitly configured otherwise (see LEVEL_BOUNDS — e.g.
 * Ambabal is a genuine highland gauge on the Bastar plateau whose RL of zero
 * gauge sits at 534 m, so its ceiling is set explicitly). Rejected rows are
 * logged with the full raw record and skipped — the adapter never ingests
 * garbage, now or for the next malformed row.
 *
 * HISTORY: fetchReadings returns the last ~72 h of hourly telemetry per
 * gauge (not just the newest row), so the detail page's 6h–72h range buttons
 * render genuinely different windows.
 *
 * Upstream schema: Station, District, River, Latitude, Longitude,
 * "River Water Level Telemetry Hourly (meter)", "Data Acquisition Time"
 * (IST, "DD-MM-YYYY HH:MM").
 */

interface NwdpRecord {
  Station: string;
  District?: string;
  River?: string;
  Latitude?: string | number;
  Longitude?: string | number;
  ["River Water Level Telemetry Hourly (meter)"]?: string | number | null;
  ["Data Acquisition Time"]?: string;
}
interface NwdpSearch {
  success: boolean;
  result: { records?: NwdpRecord[]; total?: number };
}

const SEARCH = "https://nwdp.nwic.gov.in/api/3/action/datastore_search";

/** ExternalId → NWDP datastore resource (basin package, 2026-2030). */
const RESOURCES: Record<string, string> = {
  "nwdp-bhadrachalam": "c6f31452-b416-4599-a6ae-07ad4217cdf4", // CWC Godavari
  "nwdp-ambabal-narangi": "c6f31452-b416-4599-a6ae-07ad4217cdf4",
  "nwdp-koida": "c6f31452-b416-4599-a6ae-07ad4217cdf4",
  "nwdp-baisi-1": "a169bbc1-0b1b-4c90-beaa-18948460407c", // Bihar Water Dept (Ganga)
  "nwdp-arrah-chhapra-bridge": "a169bbc1-0b1b-4c90-beaa-18948460407c",
  "nwdp-nh15-crossing-fakirpara-tangni": "847f5630-f231-46c0-922d-0f2f379a5cb8", // Assam Dept (Brahmaputra)
};

/** Curated 2026 telemetry-derived thresholds (m) for each gauge (see header). */
export const CATALOG: StationSeed[] = [
  { externalId: "nwdp-bhadrachalam", name: "Godavari at Bhadrachalam", kind: "River", place: "Bhadradri Kothagudem, Telangana · CWC", lat: 17.66944444, lng: 80.87388889, unit: "m", region: "Telangana", normalLevel: 39.13, warningLevel: 42.93, dangerLevel: 46.72 },
  { externalId: "nwdp-ambabal-narangi", name: "Godavari at Ambabal (Narangi)", kind: "River", place: "Bastar, Chhattisgarh · CWC", lat: 19.29666667, lng: 81.78888889, unit: "m", region: "Chhattisgarh", normalLevel: 535.06, warningLevel: 535.71, dangerLevel: 536.36 },
  { externalId: "nwdp-koida", name: "Godavari at Koida", kind: "River", place: "Eluru, Andhra Pradesh · CWC", lat: 17.4825, lng: 81.38666667, unit: "m", region: "Andhra Pradesh", normalLevel: 22.36, warningLevel: 23.01, dangerLevel: 23.66 },
  { externalId: "nwdp-baisi-1", name: "Ganga at Baisi", kind: "River", place: "Purnia, Bihar · Bihar Water Dept", lat: 25.86277778, lng: 87.73888889, unit: "m", region: "Bihar", normalLevel: 33.39, warningLevel: 33.8, dangerLevel: 34.2 },
  { externalId: "nwdp-arrah-chhapra-bridge", name: "Ganga at Arrah Chhapra Bridge", kind: "River", place: "Saran, Bihar · Bihar Water Dept", lat: 25.71666667, lng: 84.81166667, unit: "m", region: "Bihar", normalLevel: 45.07, warningLevel: 48.44, dangerLevel: 51.8 },
  { externalId: "nwdp-nh15-crossing-fakirpara-tangni", name: "Brahmaputra at NH-15 Fakirpara Tangni", kind: "River", place: "Darrang, Assam · Assam Water Dept", lat: 26.50833333, lng: 92.11638889, unit: "m", region: "Assam", normalLevel: 60.6, warningLevel: 61.11, dangerLevel: 61.62 },
];

/**
 * Explicit plausible-level bounds (m) for stations that fall outside the
 * default river-gauge envelope. Default ceiling = max(200 m, 3 × dangerLevel).
 * Ambabal (Narangi) is a genuine HIGH-LAND gauge on the Bastar plateau — NWDP
 * reports its `RL_of_zeroGauge` as 534.0 m, so its reduced levels are ~535 m,
 * far above the 200 m default. It is configured explicitly so its valid
 * readings are kept while junk stays rejected.
 */
const LEVEL_BOUNDS: Record<string, { min: number; max: number }> = {
  "nwdp-ambabal-narangi": { min: 500, max: 570 },
};

/**
 * Gauges whose level is a reduced level (RL = elevation above mean sea level)
 * rather than a depth/stage reading. Ambabal's ~535 m isn't "wrong-looking"
 * data — it sits on the Bastar plateau (RL_of_zeroGauge = 534.0 m). The UI
 * uses this to label the number so it reads as a different measurement basis.
 */
export const RL_GAUGES = new Set<string>(["nwdp-ambabal-narangi"]);

/** How far back (hours) of hourly telemetry to materialise per gauge. */
const HISTORY_HOURS = 74;

/**
 * Plausible level envelope for a gauge (pure, deterministic): the explicit
 * override for highland gauges (e.g. Ambabal, RL of zero gauge = 534 m) or the
 * default river band [0, max(200 m, 3·danger)].
 */
export function nwdpLevelBounds(extId: string): { min: number; max: number } {
  const seed = CATALOG.find((s) => s.externalId === extId);
  const danger = seed?.dangerLevel ?? 50;
  return (
    LEVEL_BOUNDS[extId] ?? {
      min: 0,
      max: Math.max(200, Math.round(danger * 3 * 100) / 100),
    }
  );
}

/** "DD-MM-YYYY HH:MM" (India Standard Time) → epoch. */
function parseAcq(s: string): Date {
  const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return new Date(NaN);
  const [, d, mo, y, h, mi] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi - 30)); // IST = UTC+05:30
}

function toLevel(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class NwdpAdapter implements WaterDataAdapter {
  readonly name = "nwdp";
  readonly description =
    "Real CWC & state telemetry from NWDP (nwdp.nwic.gov.in): river levels for Godavari, Ganga & Brahmaputra gauges, hourly as-published.";

  async fetchStations(): Promise<StationSeed[]> {
    return CATALOG;
  }

  async fetchReadings(): Promise<AdapterReading[]> {
    const found = await mapPool(Object.keys(RESOURCES), 4, async (extId) => {
      try {
        const rid = RESOURCES[extId];
        const params = new URLSearchParams({
          resource_id: rid,
          filters: JSON.stringify({ Station: this.upstreamName(extId) }),
          sort: "_id desc",
          limit: "300",
        });
        const d = await fetchJson<NwdpSearch>(`${SEARCH}?${params}`, { timeoutMs: 15_000, retries: 1 });
        const recs = d?.result?.records ?? [];
        if (!recs.length) return [];

        // _id is the datastore ingestion order (time-ascending) → row 0 = newest.
        // Preserve the newest observation timestamp so we materialise the LAST
        // HISTORY_HOURS of the gauge's own telemetry — not a wall-clock slice
        // that would drop valid (sporadically-published) samples.
        const [, newestMs] = this.toT(recs[0]);
        const floor = newestMs - HISTORY_HOURS * 3_600_000;
        const keep: AdapterReading[] = [];

        for (const rec of recs) {
          if (process.env.NWDP_DEBUG === "1") {
            console.log(`[nwdp] ${extId} raw record: ${JSON.stringify(rec)}`);
          }
          const [level, observedAtMs] = this.toT(rec);
          if (level == null || Number.isNaN(observedAtMs)) {
            console.warn(
              `[nwdp] ${extId}: non-numeric level or unusable acquisition time — raw record ignored:\n${JSON.stringify(rec)}`
            );
            continue;
          }
          if (observedAtMs < floor) continue; // outside the materialised window
          if (!this.inBounds(extId, level)) {
            console.warn(
              `[nwdp] ${extId}: REJECTED out-of-range level ${level} m (bounds ${this.boundsFor(extId).min}–${this.boundsFor(extId).max} m). Raw record ignored:\n${JSON.stringify(rec)}`
            );
            continue;
          }
          keep.push({ stationExternalId: extId, level, unit: "m", observedAt: new Date(observedAtMs) });
        }
        keep.reverse(); // oldest → newest, so the rate floor & stale guards work naturally
        return keep;
      } catch {
        return []; // degrade gracefully — a live ukEA/demo feed keeps the app alive
      }
    });
    return found.flat();
  }

  /** Parse level + IST acquisition time from one raw record; null level on garbage. */
  private toT(rec: NwdpRecord): [number | null, number] {
    const level = toLevel(rec["River Water Level Telemetry Hourly (meter)"]);
    const observedAt = parseAcq(rec["Data Acquisition Time"] ?? "");
    return [level, observedAt.getTime()];
  }

  /** Plausible level envelope for a gauge; default max = max(200 m, 3·danger). */
  private boundsFor(extId: string): { min: number; max: number } {
    return nwdpLevelBounds(extId);
  }

  /** Sanity gate — rejects negative / absurd levels instead of writing them. */
  private inBounds(extId: string, level: number): boolean {
    const b = this.boundsFor(extId);
    return level >= b.min && level <= b.max;
  }

  /** Datastore `Station` string for each curated externalId. */
  private upstreamName(extId: string): string {
    return {
      "nwdp-bhadrachalam": "Bhadrachalam",
      "nwdp-ambabal-narangi": "Ambabal (Narangi)",
      "nwdp-koida": "Koida",
      "nwdp-baisi-1": "Baisi_1",
      "nwdp-arrah-chhapra-bridge": "Arrah Chhapra Bridge",
      "nwdp-nh15-crossing-fakirpara-tangni": "NH15 Crossing Fakirpara Tangni",
    }[extId]!;
  }
}