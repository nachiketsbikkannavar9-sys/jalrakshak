import { fetchJson } from "../adapters/http.js";

// Open-Meteo elevation — free, no-key API. Same provider/pattern as the
// rainfall helper (services/openMeteo.ts) so the architecture stays uniform.
// A cache keyed on rounded coordinates avoids hammering it for repeated
// lookups, and failures degrade to "elevation unavailable" instead of crashing.

interface OpenMeteoElevation {
  elevation?: number | number[];
  error?: boolean;
  reason?: string;
}

export interface ElevationResult {
  elevationM: number | null;
  available: boolean;
  /** Which key the coordinates were rounded to (observability). */
  cacheKey: string;
  fetched: boolean;
  error: string | null;
}

const cache = new Map<string, { at: number; elevationM: number }>();
const CACHE_MS = 12 * 60 * 60 * 1000; // terrain changes slowly; 12h is plenty

// Override-able for tests / forced-outage simulation (TEST 3): point this at a
// dead URL and the service degrades to "elevation unavailable" instead of
// crashing or fabricating a value.
const API_URL = process.env.ELEVATION_API_URL ?? "https://api.open-meteo.com/v1/elevation";

/**
 * Ground elevation (metres) for a lat/lng. Returns `null` elevation with
 * `available: false` on any failure — the exposure model handles that by
 * dropping the elevation component rather than guessing.
 */
export async function getElevationM(
  lat: number,
  lng: number
): Promise<ElevationResult> {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;

  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return {
      elevationM: hit.elevationM,
      available: true,
      cacheKey,
      fetched: false,
      error: null,
    };
  }

  try {
    const data = await fetchJson<OpenMeteoElevation>(
      `${API_URL}?latitude=${lat}&longitude=${lng}`,
      { timeoutMs: 6000, retries: 1 }
    );
    const raw = Array.isArray(data.elevation) ? data.elevation[0] : data.elevation;
    const elevationM =
      typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    if (elevationM != null) {
      cache.set(cacheKey, { at: Date.now(), elevationM });
      return {
        elevationM,
        available: true,
        cacheKey,
        fetched: true,
        error: null,
      };
    }
    return {
      elevationM: null,
      available: false,
      cacheKey,
      fetched: true,
      error: data.reason ?? "elevation-api-returned-no-value",
    };
  } catch {
    return {
      elevationM: null,
      available: false,
      cacheKey,
      fetched: false,
      error: "elevation-api-unavailable",
    };
  }
}