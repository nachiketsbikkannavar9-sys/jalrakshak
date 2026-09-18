import { fetchJson } from "../adapters/http.js";

// Open-Meteo — free, no-key weather API. Used as a second signal (Stage 4-ish)
// for stations that enable rainfallEnabled; a cache avoids hammering it.
interface OpenMeteoCurrent {
  current?: { precipitation?: number };
}

const cache = new Map<string, { at: number; mm: number }>();
const CACHE_MS = 60 * 60 * 1000;

/** Forecast precipitation (mm, latest hour) for a location. 0 on any failure. */
export async function getRainfallMm(lat: number, lng: number): Promise<number> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.mm;
  try {
    const data = await fetchJson<OpenMeteoCurrent>(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=precipitation&timezone=auto`,
      { timeoutMs: 6000, retries: 0 }
    );
    const mm = Math.max(0, data.current?.precipitation ?? 0);
    cache.set(key, { at: Date.now(), mm });
    return mm;
  } catch {
    cache.set(key, { at: Date.now(), mm: 0 });
    return 0;
  }
}