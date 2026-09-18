import type { AlertDTO, HistoryPoint, IntervalStats, LatestReading, NationalStats, RiskCategory, StationDTO, StationKind } from "../../../shared/src/index.js";
import { categoryFromScore, explainRisk, sanitizeRateOfRise, type LevelBasis } from "../../../shared/src/index.js";
import { RL_GAUGES } from "../adapters/nwdp.adapter.js";
import type { Alert, Reading, Station } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { toAlertDTO } from "./alertDispatcher.js";
import { projectThresholds } from "./projection.js";

export const SOURCE_LABELS: Record<string, string> = {
  ukEA: "UK EA · live",
  usgs: "USGS · live",
  demo: "Simulated",
  seed: "Simulated (offline)",
  wris: "India-WRIS",
  nwdp: "INDIA · NWDP",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

async function loadBundle(): Promise<{ stations: Station[]; byStation: Map<string, Reading[]> }> {
  const [stations, readings] = await Promise.all([
    prisma.station.findMany({ orderBy: { name: "asc" } }),
    prisma.reading.findMany({
      where: { observedAt: { gte: new Date(Date.now() - 72 * 3_600_000) } },
      orderBy: { observedAt: "asc" },
    }),
  ]);
  const byStation = new Map<string, Reading[]>();
  for (const r of readings) {
    const arr = byStation.get(r.stationId) ?? [];
    arr.push(r);
    byStation.set(r.stationId, arr);
  }
  return { stations, byStation };
}

export function toStationDTO(station: Station, readings: Reading[]): StationDTO {
  const recent = readings.slice(-48);
  const last = recent[recent.length - 1] ?? null;
  const latest: LatestReading | null = last
    ? {
        level: last.level,
        unit: station.unit,
        riskScore: last.riskScore ?? 0,
        category: (last.riskCategory as RiskCategory) ?? categoryFromScore(last.riskScore ?? 0),
        rateOfRise: sanitizeRateOfRise(last.rateOfRise),
        rainfallMm: last.rainfallMm,
        observedAt: last.observedAt.toISOString(),
        projection: projectThresholds({
          level: last.level,
          warningLevel: station.warningLevel,
          dangerLevel: station.dangerLevel,
          riseRateH: last.rateOfRise,
        }),
        explain: explainForStation(station, last),
      }
    : null;
  return {
    id: station.id,
    externalId: station.externalId,
    source: station.source,
    sourceLabel: sourceLabel(station.source),
    simulated: station.simulated,
    name: station.name,
    kind: station.kind as StationKind,
    place: station.place,
    region: station.region ?? null,
    lat: station.lat,
    lng: station.lng,
    unit: station.unit,
    levelBasis: (station.externalId && RL_GAUGES.has(station.externalId) ? "RL" : "Depth") as LevelBasis,
    normalLevel: station.normalLevel,
    warningLevel: station.warningLevel,
    dangerLevel: station.dangerLevel,
    riskConfig: {
      weightProximity: station.weightProximity,
      weightRise: station.weightRise,
      weightRain: station.weightRain,
      riseNormDivisor: station.riseNormDivisor,
      rainfallEnabled: station.rainfallEnabled,
      alertCooldownMin: station.alertCooldownMin,
    },
    latest,
    recent: recent.map((r) => ({ t: r.observedAt.getTime(), v: r.level })),
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Reproduce the persisted score's components exactly from stored reading values,
 *  so the UI can explain WHY without any separate data. */
export function explainForStation(station: Station, reading: Reading): LatestReading["explain"] {
  const range = Math.max(1e-6, station.dangerLevel - station.normalLevel);
  const proximity = clamp01((reading.level - station.normalLevel) / range);
  const riseNorm = clamp01((reading.rateOfRise ?? 0) / (range * station.riseNormDivisor));
  const rainfallNorm = clamp01((reading.rainfallMm ?? 0) / 100);
  return explainRisk({
    proximity,
    riseNorm,
    rainfallNorm,
    weights: { proximity: station.weightProximity, rise: station.weightRise, rain: station.weightRain },
  });
}

export async function buildStationsDTO(): Promise<StationDTO[]> {
  const { stations, byStation } = await loadBundle();
  return stations.map((s) => toStationDTO(s, byStation.get(s.id) ?? []));
}

export async function getStationDTO(stationId: string): Promise<StationDTO | null> {
  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) return null;
  const readings = await prisma.reading.findMany({
    where: { stationId, observedAt: { gte: new Date(Date.now() - 72 * 3_600_000) } },
    orderBy: { observedAt: "asc" },
  });
  return toStationDTO(station, readings);
}

export function nationalStats(dtos: StationDTO[]): NationalStats {
  const scores = dtos
    .map((d) => d.latest?.riskScore)
    .filter((s): s is number => typeof s === "number");
  const byCategory = Object.fromEntries(
    (["Normal", "Watch", "Warning", "Severe", "Critical"] as RiskCategory[]).map((c) => [c, 0])
  ) as Record<RiskCategory, number>;
  for (const d of dtos) {
    if (d.latest) byCategory[d.latest.category] += 1;
  }
  const updated = dtos
    .map((d) => (d.latest ? new Date(d.latest.observedAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  return {
    nationalIndex: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    totalStations: dtos.length,
    withReadings: scores.length,
    byCategory,
    updatedAt: updated ? new Date(updated).toISOString() : null,
  };
}

export async function buildStationsAndStats(): Promise<{ stations: StationDTO[]; stats: NationalStats }> {
  const stations = await buildStationsDTO();
  return { stations, stats: nationalStats(stations) };
}

export async function buildHistory(stationId: string, hours: number): Promise<{ points: HistoryPoint[]; stats: IntervalStats }> {
  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) throw new Error("station not found");
  const readings = await prisma.reading.findMany({
    where: { stationId, observedAt: { gte: new Date(Date.now() - hours * 3_600_000) } },
    orderBy: { observedAt: "asc" },
  });
  const points: HistoryPoint[] = readings.map((r) => ({
    t: r.observedAt.getTime(),
    v: r.level,
    riskScore: r.riskScore,
    category: (r.riskCategory as RiskCategory) ?? categoryFromScore(r.riskScore ?? 0),
  }));
  const values = points.map((p) => p.v);
  const last = points[points.length - 1] ?? null;
  const prev = points[points.length - 2] ?? null;
  const rate = sanitizeRateOfRise(
    last && prev && last.t - prev.t >= 2 * 60_000
      ? Math.round(((last.v - prev.v) / ((last.t - prev.t) / 3_600_000)) * 1000) / 1000
      : null
  );
  return {
    points,
    stats: {
      label: `${hours}h`,
      rateOfRise: rate,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      avg: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000 : null,
      current: last?.v ?? null,
      category: last ? (last.category as RiskCategory) : null,
    },
  };
}

export async function buildAlertsDTO(
  limit = 100,
  stationWhere?: Prisma.StationWhereInput
): Promise<AlertDTO[]> {
  const rows = await prisma.alert.findMany({
    where: stationWhere ? { station: stationWhere } : undefined,
    include: { station: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((row) => toAlertDTO(row as Alert & { station: Station }, row.station));
}