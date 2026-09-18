import type { AdapterReading, StationSeed, WaterDataAdapter } from "./types.js";
import { fetchJson, fetchText, mapPool } from "./http.js";

/**
 * USGS Instantaneous Values API (no key). Second guaranteed live fallback,
 * US gauges. Gage heights (00065) are reported in feet and converted to m.
 *
 * Warning/danger thresholds are NOT hardcoded: they are derived from each
 * gauge's observed 30-day distribution (p90 / p98 of recent gage height),
 * which we document as a proxy until a real NWS flood-stage feed is wired in.
 */
const IV = "https://waterservices.usgs.gov/nwis/iv/";
const SITE = "https://waterservices.usgs.gov/nwis/site/";

const SITES = [
  "09380000", // Colorado River at Lees Ferry, AZ
  "09512200", // Salt River below Stewart Mountain Dam, AZ
  "09260110", // Green River near ...
  "02412000", // Coosawattee River ... 
  "01646500", // Potomac River at Little Falls, DC
  "08278500", // Rio Grande near Pilar, NM
];

interface IvResponse {
  value?: {
    timeSeries?: {
      sourceInfo?: { siteCode?: { value?: string } };
      variable?: { noDataValue?: number };
      values?: { value?: { value?: string; dateTime?: string }[] }[];
    }[];
  };
}
interface SiteResponse { value?: { sites?: { site?: { siteInfo?: unknown[] }[] }[] } }

interface GaugeMeta {
  site: string;
  name: string;
  lat: number;
  lng: number;
}

function parseRdbSites(text: string): GaugeMeta[] {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  const out: GaugeMeta[] = [];
  for (const row of lines.slice(1)) {
    const cells = row.split("\t");
    const get = (k: string) => {
      const i = header.indexOf(k);
      return i >= 0 ? cells[i] : undefined;
    };
    const site = get("site_no");
    if (!site) continue;
    const lat = Number(get("dec_lat_va"));
    const lng = Number(get("dec_long_va"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ site, name: get("station_nm") ?? site, lat, lng });
  }
  return out;
}

export class UsgsAdapter implements WaterDataAdapter {
  readonly name = "usgs";
  readonly description =
    "Live gage heights from the USGS Instantaneous Values API (no key). Thresholds derived from each gauge's 30-day observed distribution.";

  async fetchReadings(): Promise<AdapterReading[]> {
    const series = await fetchJson<IvResponse>(
      `${IV}?format=json&sites=${SITES.join(",")}&parameterCd=00065&siteStatus=all`
    );
    const out: AdapterReading[] = [];
    for (const ts of series.value?.timeSeries ?? []) {
      const site = ts.sourceInfo?.siteCode?.value;
      const noData = ts.variable?.noDataValue ?? -999999;
      const first = ts.values?.[0]?.value?.[0];
      if (!site || !first) continue;
      const v = Number(first.value);
      if (!Number.isFinite(v) || v === noData) continue;
      out.push({
        stationExternalId: `usgs:${site}`,
        level: Math.round(v * 0.3048 * 1000) / 1000, // ft -> m
        unit: "m",
        observedAt: first.dateTime ? new Date(first.dateTime) : new Date(),
      });
    }
    return out;
  }

  async fetchStations(): Promise<StationSeed[]> {
    const text = await fetchText(
      `${SITE}?format=rdb&sites=${SITES.join(",")}&siteOutput=expanded`
    );
    const metas = parseRdbSites(text);
    const stations = await mapPool(metas, 4, async (meta) => {
      try {
        const hist = await fetchJson<IvResponse>(
          `${IV}?format=json&sites=${meta.site}&parameterCd=00065&period=P30D&siteStatus=all`,
          { timeoutMs: 12_000 }
        );
        const ts = hist.value?.timeSeries?.[0];
        const noData = ts?.variable?.noDataValue ?? -999999;
        const vals: number[] = [];
        for (const p of ts?.values?.[0]?.value ?? []) {
          const v = Number(p.value);
          if (Number.isFinite(v) && v !== noData) vals.push(v);
        }
        if (vals.length < 24) return null;
        vals.sort((a, b) => a - b);
        const pct = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
        const low = pct(0.5);
        const high = pct(0.95);
        const danger = pct(0.99);
        if (high <= low || danger <= high) return null;
        return {
          externalId: `usgs:${meta.site}`,
          name: meta.name,
          kind: "River" as const,
          place: meta.name,
          lat: meta.lat,
          lng: meta.lng,
          unit: "m",
          region: "United States",
          normalLevel: Math.round(low * 0.3048 * 1000) / 1000,
          warningLevel: Math.round(high * 0.3048 * 1000) / 1000,
          dangerLevel: Math.round(danger * 0.3048 * 1000) / 1000,
        };
      } catch {
        return null;
      }
    });
    return stations.filter((s) => s !== null) as StationSeed[];
  }
}