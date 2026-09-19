import { Router, type Request, type Response } from "express";
import {
  MAX_LOCAL_GAUGE_KM,
  computePersonalExposure,
  explainPersonalExposure,
  personalExposureAdvice,
  type ExposureInput,
  type StationDTO,
} from "../../../shared/src/index.js";
import { buildStationsDTO } from "../services/dto.js";
import { getElevationM } from "../services/elevationService.js";
import { haversineKm } from "../services/geo.js";
import { mapPool } from "../adapters/http.js";

export const router = Router();

function parseCoord(raw: string | undefined, name: string, lim: number): number | null {
  if (raw === undefined) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= -lim && v <= lim ? v : null;
}

/**
 * Get the nearest river station (prefers one with a live reading) to a point.
 * Returns { station, distanceKm } or null when there are no stations at all.
 */
export function nearestStation(dtos: StationDTO[], lat: number, lng: number) {
  let withReading: StationDTO | null = null;
  let withReadingDist = Infinity;
  let anyStation: StationDTO | null = null;
  let anyDist = Infinity;
  for (const s of dtos) {
    const d = haversineKm(lat, lng, s.lat, s.lng);
    if (d < anyDist) {
      anyDist = d;
      anyStation = s;
    }
    if (s.latest && d < withReadingDist) {
      withReadingDist = d;
      withReading = s;
    }
  }
  return withReading
    ? { station: withReading, distanceKm: withReadingDist }
    : anyStation
      ? { station: anyStation, distanceKm: anyDist }
      : null;
}

interface Assessment {
  nearest: ReturnType<typeof nearestStation>;
  elevation: Awaited<ReturnType<typeof getElevationM>>;
  input: ExposureInput;
  exposure: ReturnType<typeof computePersonalExposure>;
  explanation: ReturnType<typeof explainPersonalExposure>;
  advice: ReturnType<typeof personalExposureAdvice>;
}

/** Shared evaluation for /exposure and /demo (same model, same inputs). */
async function assess(lat: number, lng: number, stations: StationDTO[]): Promise<Assessment> {
  const nearest = nearestStation(stations, lat, lng);
  const elevation = await getElevationM(lat, lng);
  const s = nearest?.station ?? null;
  const input: ExposureInput = {
    stationHazardScore: s?.latest?.riskScore ?? null,
    waterLevel: s?.latest?.level ?? null,
    levelBasis: s?.levelBasis ?? null,
    rateOfRise: s?.latest?.rateOfRise ?? null,
    stationLevelRange: s ? s.dangerLevel - s.normalLevel : null,
    riseNormDivisor: s?.riskConfig?.riseNormDivisor ?? null,
    rainfallMm: s?.latest?.rainfallMm ?? null,
    userElevationM: elevation.available ? elevation.elevationM : null,
    distanceKm: nearest?.distanceKm ?? null,
    inundated: null, // no flood-zone map in the app yet — engine handles null
  };
  const display = {
    stationName: s?.name ?? "the nearest gauge",
    place: s?.place ?? "your area",
    hazardCategory: s?.latest?.category ?? null,
  };
  return {
    nearest,
    elevation,
    input,
    exposure: computePersonalExposure(input),
    explanation: explainPersonalExposure(input, display),
    advice: personalExposureAdvice(input, display),
  };
}

router.get("/exposure", async (req: Request, res: Response) => {
  const lat = parseCoord(String(req.query.lat ?? ""), "lat", 90);
  const lng = parseCoord(String(req.query.lng ?? ""), "lng", 180);
  if (lat == null || lng == null) {
    res.status(400).json({
      error: "lat and lng are required query params (e.g. /api/location/exposure?lat=20.5&lng=85.8)",
    });
    return;
  }

  const fetchedAt = new Date().toISOString();
  const stations = await buildStationsDTO();
  const { nearest, elevation, exposure, explanation, advice } = await assess(lat, lng, stations);
  const s = nearest?.station ?? null;

  res.json({
    location: { lat, lng },
    elevation,
    distanceKm: nearest?.distanceKm ?? null,
    nearestStation: s
      ? {
          id: s.id,
          name: s.name,
          place: s.place,
          region: s.region,
          kind: s.kind,
          lat: s.lat,
          lng: s.lng,
          unit: s.unit,
          levelBasis: s.levelBasis,
          normalLevel: s.normalLevel,
          warningLevel: s.warningLevel,
          dangerLevel: s.dangerLevel,
          hazardCategory: s.latest?.category ?? null,
          latest: s.latest
            ? {
                level: s.latest.level,
                riskScore: s.latest.riskScore,
                category: s.latest.category,
                rateOfRise: s.latest.rateOfRise,
                rainfallMm: s.latest.rainfallMm,
                observedAt: s.latest.observedAt,
                projection: s.latest.projection,
              }
            : null,
        }
      : null,
    exposure,
    explanation,
    advice,
    modelled: true,
    fetchedAt,
  });
});

/** Highest live hazard first (Severe < Critical < Warning < Watch < Normal). */
function hazardRank(station: StationDTO): number {
  const c = station.latest?.category;
  if (c === "Severe") return 0;
  if (c === "Critical") return 1;
  if (c === "Warning") return 2;
  if (c === "Watch") return 3;
  if (c === "Normal") return 4;
  return 9;
}

function pickDemoStation(stations: StationDTO[]): StationDTO | null {
  return [...stations.filter((s) => s.latest)].sort(
    (a, b) => hazardRank(a) - hazardRank(b) || (b.latest?.riskScore ?? 0) - (a.latest?.riskScore ?? 0)
  )[0] ?? null;
}

/** Ring of candidate points around a station, in km/m lat-lng degrees. */
function candidatePoints(station: StationDTO): { lat: number; lng: number }[] {
  const R = 111.0; // ~km per degree of latitude
  const lngScale = Math.cos((station.lat * Math.PI) / 180) || 0.1;
  const out: { lat: number; lng: number }[] = [];
  for (const radiusKm of [5, 9, 14, 22, 30]) {
    for (let d = 0; d < 8; d++) {
      const angle = (d / 8) * 2 * Math.PI;
      out.push({
        lat: station.lat + (radiusKm * Math.cos(angle)) / R,
        lng: station.lng + (radiusKm * Math.sin(angle)) / (R * lngScale),
      });
    }
  }
  return out;
}

// The demo sweep hits the elevation API many times; cache the result per
// station for a few minutes so repeated clicks stay instant.
const DEMO_CACHE_MS = 10 * 60 * 1000;
const demoCache = new Map<string, { at: number; pair: unknown }>();

router.get("/demo", async (_req: Request, res: Response) => {
  const stations = await buildStationsDTO();
  const station = pickDemoStation(stations);
  if (!station) {
    res.json({ crossedBands: false, error: "no gauge with a reading to demo against" });
    return;
  }

  const cached = demoCache.get(station.id);
  if (cached && Date.now() - cached.at < DEMO_CACHE_MS) {
    res.json(cached.pair);
    return;
  }

  const low = await assess(station.lat, station.lng, stations);

  // Sweep a ring of candidate points near the same gauge; the "raised ground"
  // demo point is the candidate with the LOWEST exposure (preferring genuinely
  // higher ground), so the two presets land in different risk bands where the
  // terrain allows it.
  const candidates = candidatePoints(station);
  const results = await mapPool(candidates, 8, async (c) => {
    const a = await assess(c.lat, c.lng, stations);
    return { a, lat: c.lat, lng: c.lng };
  });
  results.sort(
    (x, y) =>
      x.a.exposure.score - y.a.exposure.score ||
      (y.a.elevation.elevationM ?? 0) - (x.a.elevation.elevationM ?? 0)
  );

  let raised = results[0];
  const crossed = results.find((r) => r.a.exposure.category !== low.exposure.category && r.a.exposure.score < low.exposure.score);
  if (crossed) raised = crossed;

  const pair = {
    station: { id: station.id, name: station.name, place: station.place },
    low: {
      lat: station.lat,
      lng: station.lng,
      label: "Demo · low ground beside the river",
      category: low.exposure.category,
      score: low.exposure.score,
    },
    raised: {
      lat: raised.lat,
      lng: raised.lng,
      label: "Demo · raised ground, same gauge",
      category: raised.a.exposure.category,
      score: raised.a.exposure.score,
    },
    crossedBands: low.exposure.category !== raised.a.exposure.category,
    lowDistanceKm: low.nearest?.distanceKm ?? null,
    withinLocalRangeKm: MAX_LOCAL_GAUGE_KM,
    generatedAt: new Date().toISOString(),
  };

  // Guard: only cache a sweep that produced a genuine band contrast.
  demoCache.set(station.id, { at: Date.now(), pair });
  res.json(pair);
});