import type { AdapterReading, StationSeed, WaterDataAdapter } from "./types.js";
import { fetchJson, mapPool } from "./http.js";

/**
 * UK Environment Agency — FFD real-time flood monitoring API.
 * Live river levels, no key, no registration. Guaranteed-working live source
 * for demo day. https://environment.data.gov.uk/flood-monitoring/doc/reference
 *
 * Stations are gauges physically in England; the product is source-agnostic
 * and a CWC/India-WRIS feed can replace this via the same adapter interface.
 */
const API = "https://environment.data.gov.uk/flood-monitoring";

interface EaStationList { items: { stationReference: string }[] }
interface EaMeasure { qualifier?: string; latestReading?: { value: number; dateTime: string } }
interface EaStation {
  stationReference: string;
  label: string;
  riverName?: string;
  town?: string;
  lat?: number | null;
  long?: number | null;
  stageScale?: {
    typicalRangeLow?: number;
    typicalRangeHigh?: number;
    highestRecent?: { value: number };
    maxOnRecord?: { value: number };
  };
  measures: EaMeasure[];
}
interface EaStationDetail {
  items: EaStation | EaStation[];
}
interface EaReadingRow { dateTime: string; value: number; measure: string }
interface EaReadings { items: EaReadingRow | EaReadingRow[] }

const MAX_STATIONS = 45;

const isStageMeasure = (measure: string) => measure.includes("-level-stage-") || measure.includes("-level-stage1-");

function firstStation(items: EaStation | EaStation[]): EaStation | null {
  const arr = Array.isArray(items) ? items : [items];
  return arr[0] ?? null;
}
function rows(items: EaReadingRow | EaReadingRow[]): EaReadingRow[] {
  return Array.isArray(items) ? items : [items];
}

export class UkEaAdapter implements WaterDataAdapter {
  readonly name = "ukEA";
  readonly description =
    "Live river level telemetry from the UK Environment Agency API (no key). Demo-day reliable live source; production can swap in CWC/India-WRIS via the same interface.";

  private refs: string[] = [];
  private lastListAt = 0;
  private readonly listCacheMs = 3_600_000;

  private async ensureRefs(): Promise<void> {
    if (this.refs.length && Date.now() - this.lastListAt < this.listCacheMs) return;
    const list = await fetchJson<EaStationList>(
      `${API}/id/stations?parameter=level&status=Active&_limit=${MAX_STATIONS}`
    );
    this.refs = (list.items ?? []).map((s) => s.stationReference).slice(0, MAX_STATIONS);
    this.lastListAt = Date.now();
  }

  async fetchStations(): Promise<StationSeed[]> {
    await this.ensureRefs();
    const details = await mapPool(this.refs, 14, async (ref) => {
      try {
        return await fetchJson<EaStationDetail>(`${API}/id/stations/${ref}.json`, { timeoutMs: 7000, retries: 0 });
      } catch {
        return null;
      }
    });

    const stations: StationSeed[] = [];
    for (const d of details) {
      if (!d) continue;
      const station = firstStation(d.items);
      if (!station) continue;
      if (station.lat == null || station.long == null) continue;
      const ss = station.stageScale;
      if (!ss) continue;
      const normalLevel = ss.typicalRangeLow ?? 0;
      const warningLevel = ss.highestRecent?.value ?? ss.typicalRangeHigh ?? null;
      const dangerLevel = ss.maxOnRecord?.value ?? (warningLevel != null ? warningLevel * 1.3 : null);
      if (warningLevel == null || dangerLevel == null || dangerLevel <= normalLevel || warningLevel <= normalLevel) {
        continue;
      }
      const measures = Array.isArray(station.measures) ? station.measures : [];
      const hasStageMeasure = measures.some((m) => m?.qualifier === "Stage");
      if (!hasStageMeasure) continue;
      stations.push({
        externalId: station.stationReference,
        name: station.label,
        kind: "River",
        place: station.town ?? station.riverName ?? "United Kingdom",
        lat: station.lat,
        lng: station.long,
        unit: "m",
        region: "United Kingdom",
        normalLevel,
        warningLevel,
        dangerLevel,
      });
    }
    return stations;
  }

  async fetchReadings(): Promise<AdapterReading[]> {
    await this.ensureRefs();
    const found = await mapPool(this.refs, 14, async (ref) => {
      try {
        const r = await fetchJson<EaReadings>(`${API}/id/stations/${ref}/readings?latest`, { timeoutMs: 7000, retries: 0 });
        const stage = rows(r.items).find((it) => isStageMeasure(it.measure)) ?? rows(r.items)[0];
        if (!stage) return null;
        const observedAt = new Date(stage.dateTime);
        if (Number.isNaN(observedAt.getTime())) return null;
        return {
          stationExternalId: ref,
          level: Number(stage.value),
          unit: "m",
          observedAt,
        };
      } catch {
        return null;
      }
    });
    return found.filter((x): x is AdapterReading => x !== null);
  }
}