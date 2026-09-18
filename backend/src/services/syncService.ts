import { prisma } from "../db/prisma.js";
import { config } from "../config.js";
import { emit } from "../socket.js";
import { activeAdapters } from "../adapters/index.js";
import type { AdapterReading, WaterDataAdapter } from "../adapters/types.js";
import { computeRisk } from "./riskEngine.js";
import { getRainfallMm } from "./openMeteo.js";
import { maybeAlertForStation } from "./alertDispatcher.js";
import { getStationDTO } from "./dto.js";
import type { Station } from "@prisma/client";

/** Marker adapter used when the admin "gradual rise" tool writes readings. */
const TREND_ADAPTER = { name: "trend" } as unknown as WaterDataAdapter;

/**
 * Orchestrates: register stations from each adapter -> pull readings ->
 * compute risk server-side -> persist -> optionally dispatch alerts ->
 * push live updates over WebSocket.
 */
export class SyncService {
  private syncing = false;
  private lastStationRefresh = new Map<string, number>();

  async syncAll(force = false): Promise<void> {
    if (this.syncing) {
      console.log("[sync] already running, skipping tick");
      return;
    }
    this.syncing = true;
    try {
      for (const adapter of activeAdapters()) {
        try {
          await this.syncAdapter(adapter, force);
        } catch (err) {
          console.error(`[sync] ${adapter.name} failed:`, (err as Error).message);
        }
      }
      console.log(`[sync] tick complete · ${new Date().toISOString()}`);
    } finally {
      this.syncing = false;
    }
  }

  private async syncAdapter(adapter: WaterDataAdapter, force: boolean) {
    const last = this.lastStationRefresh.get(adapter.name) ?? 0;
    const due =
      force || Date.now() - last >= config.stationRefreshHr * 3_600_000;
    if (due) {
      await this.ensureStations(adapter);
      this.lastStationRefresh.set(adapter.name, Date.now());
    }
    let readings: AdapterReading[] = [];
    try {
      readings = await adapter.fetchReadings();
    } catch (err) {
      console.error(`[sync] ${adapter.name} fetchReadings failed:`, (err as Error).message);
      return;
    }
    for (const r of readings) await this.ingestReading(adapter, r);
  }

  async ensureStations(adapter: WaterDataAdapter): Promise<void> {
    const seeds = await adapter.fetchStations();
    for (const seed of seeds) {
      await prisma.station.upsert({
        where: { externalId: seed.externalId },
        create: {
          externalId: seed.externalId,
          source: adapter.name,
          simulated: seed.simulated ?? false,
          name: seed.name,
          kind: seed.kind,
          place: seed.place,
          region: seed.region ?? null,
          lat: seed.lat,
          lng: seed.lng,
          unit: seed.unit,
          normalLevel: seed.normalLevel,
          warningLevel: seed.warningLevel,
          dangerLevel: seed.dangerLevel,
          riseNormDivisor: seed.riseNormDivisor ?? 0.06,
          weightProximity: seed.weightProximity ?? 60,
          weightRise: seed.weightRise ?? 30,
          weightRain: seed.weightRain ?? 10,
          rainfallEnabled: seed.rainfallEnabled ?? false,
          alertCooldownMin: seed.alertCooldownMin ?? 30,
        },
        update: {
          source: adapter.name,
          name: seed.name,
          place: seed.place,
          region: seed.region ?? null,
          lat: seed.lat,
          lng: seed.lng,
          kind: seed.kind,
          normalLevel: seed.normalLevel,
          warningLevel: seed.warningLevel,
          dangerLevel: seed.dangerLevel,
        },
      });
    }
  }

  /** Ingest one reading for a registered station. */
  private async ingestReading(adapter: WaterDataAdapter, r: AdapterReading) {
    let station = await prisma.station.findUnique({
      where: { externalId: r.stationExternalId },
    });
    if (!station) {
      await this.ensureStations(adapter);
      station = await prisma.station.findUnique({
        where: { externalId: r.stationExternalId },
      });
      if (!station) return;
    }

    // While an admin "gradual rise" job owns this station, ONLY trend writes
    // are allowed — otherwise the adapter's 2-minute polls reset the rate
    // clock and the projection never gets a clean window.
    if (this.trends.has(station.id) && adapter.name !== "trend") return;

    const prev = await prisma.reading.findFirst({
      where: { stationId: station.id, observedAt: { lt: r.observedAt } },
      orderBy: { observedAt: "desc" },
    });
    if (prev && r.observedAt.getTime() <= prev.observedAt.getTime()) return; // stale echo

    const rainfallMm = station.rainfallEnabled
      ? await getRainfallMm(station.lat, station.lng)
      : null;

    const risk = computeRisk({
      level: r.level,
      normalLevel: station.normalLevel,
      dangerLevel: station.dangerLevel,
      riseNormDivisor: station.riseNormDivisor,
      weights: {
        proximity: station.weightProximity,
        rise: station.weightRise,
        rain: station.weightRain,
      },
      rainfallMm,
      prev: prev ?? undefined,
      now: r.observedAt,
    });

    // Debug trail for real-government-feeder stations (NWDP): record the actual
    // inter-reading gap and the (floored/sanitised) rate so a suspicious value
    // like "rise +6.134 m/h" on Arrah Chhapra Bridge can be audited: either a
    // genuine ≥floor hourly sample (kept, as here) or an ingestion artifact
    // (gap < floor / implausible magnitude → omitted). This station is the
    // primary "real government data" talking point and must be trustworthy.
    if (station.source === "nwdp") {
      const gapMs = prev ? r.observedAt.getTime() - prev.observedAt.getTime() : null;
      console.log(
        `[nwdp] ${station.externalId} level ${r.level}${station.unit} @ ${r.observedAt.toISOString()} · gap ${gapMs != null ? Math.round(gapMs / 1000) + "s" : "first"} · rate ${risk.riseRateH ?? "omitted"}`
      );
    }

    await prisma.reading.upsert({
      where: {
        stationId_observedAt: { stationId: station.id, observedAt: r.observedAt },
      },
      create: {
        stationId: station.id,
        level: r.level,
        riskScore: risk.score,
        riskCategory: risk.category,
        rateOfRise: risk.riseRateH,
        rainfallMm,
        observedAt: r.observedAt,
      },
      update: {
        level: r.level,
        riskScore: risk.score,
        riskCategory: risk.category,
        rateOfRise: risk.riseRateH,
        rainfallMm,
      },
    });
    await this.afterIngest(station, r, risk.score, risk.category, risk.riseRateH);
  }

  /**
   * Used by the authority console's "trigger demo spike" — inject a reading at
   * the current time so an alert can be demonstrated on demand.
   */
  async forceReading(
    stationExternalIdOrId: string,
    level: number
  ): Promise<{ stationId: string; alerts: number }> {
    const station = await this.resolveStation(stationExternalIdOrId);
    if (!station) throw new Error(`unknown station ${stationExternalIdOrId}`);
    const prev = await prisma.reading.findFirst({
      where: { stationId: station.id },
      orderBy: { observedAt: "desc" },
    });
    const rainfallMm = station.rainfallEnabled
      ? await getRainfallMm(station.lat, station.lng)
      : null;
    const risk = computeRisk({
      level,
      normalLevel: station.normalLevel,
      dangerLevel: station.dangerLevel,
      riseNormDivisor: station.riseNormDivisor,
      weights: {
        proximity: station.weightProximity,
        rise: station.weightRise,
        rain: station.weightRain,
      },
      rainfallMm,
      prev: prev ?? undefined,
      now: new Date(),
    });
    const row = await prisma.reading.create({
      data: {
        stationId: station.id,
        level,
        riskScore: risk.score,
        riskCategory: risk.category,
        rateOfRise: risk.riseRateH,
        rainfallMm,
        observedAt: new Date(),
      },
    });
    const alerts = await maybeAlertForStation(station, {
      riskScore: risk.score,
      category: risk.category,
      level,
      rateOfRise: risk.riseRateH,
    });
    const dto = await getStationDTO(station.id);
    if (dto) emit("station:update", dto);
    console.log(`[admin] forced reading ${level}${station.unit} at ${station.name} → risk ${risk.score} (${risk.category}), ${alerts.length} alert(s)`);
    return { stationId: station.id, alerts: alerts.length };
  }

  private async resolveStation(key: string): Promise<Station | null> {
    return (
      (await prisma.station.findUnique({ where: { id: key } })) ??
      (await prisma.station.findUnique({ where: { externalId: key } }))
    );
  }

  // ── Gradual-rise simulator ────────────────────────────────────────────────
  // Distinct from the instant force-spike: writes readings with a REAL,
  // monotonic time gap (≥ the 2-minute rate floor) so the "time to threshold"
  // projection legitimately appears and updates as the level climbs, then
  // disappears when the rise is stopped ("flatten") or the level falls.

  private readonly trends = new Map<string, { startAt: number; deadline: number; risePerHr: number }>();
  private trendTimer: NodeJS.Timeout | null = null;

  async startGradualRise(
    stationKey: string,
    risePerHr: number,
    minutes: number
  ): Promise<{ stationId: string; materialized: number }> {
    const station = await this.resolveStation(stationKey);
    if (!station) throw new Error(`unknown station ${stationKey}`);
    const job = {
      startAt: Date.now(),
      deadline: Date.now() + Math.max(1, minutes) * 60_000,
      risePerHr,
    };
    this.trends.set(station.id, job);
    const materialized = await this.materializeTrend(station, job);
    this.ensureTrendTimer();
    return { stationId: station.id, materialized };
  }

  /** Cancel a trend AND flatten: writes one same-level reading so the rate
   *  returns to ~0 and any projection disappears immediately. */
  async stopGradualRise(stationKey: string): Promise<{ stationId: string; flattened: boolean }> {
    const station = await this.resolveStation(stationKey);
    if (!station) return { stationId: stationKey, flattened: false };
    this.trends.delete(station.id);
    const last = await prisma.reading.findFirst({
      where: { stationId: station.id },
      orderBy: { observedAt: "desc" },
    });
    if (last) {
      await this.ingestReading(TREND_ADAPTER, {
        stationExternalId: station.externalId,
        level: last.level,
        unit: station.unit,
        observedAt: new Date(),
      });
    }
    return { stationId: station.id, flattened: true };
  }

  /** Write a backdated chain of readings (spaced ≥ the 2-min rate floor) so a
   *  viable rate exists immediately. Returns the number written. */
  private async materializeTrend(station: Station, job: { risePerHr: number }): Promise<number> {
    const last = await prisma.reading.findFirst({
      where: { stationId: station.id },
      orderBy: { observedAt: "desc" },
    });
    const stepMs = 130_000; // just above the 2-minute floor
    const stepLevel = job.risePerHr * (stepMs / 3_600_000);
    let t = last ? last.observedAt.getTime() : Date.now() - 2 * stepMs;
    let level = last?.level ?? station.normalLevel;
    let written = 0;
    while (t + stepMs <= Date.now()) {
      t += stepMs;
      level += stepLevel;
      await this.ingestReading(TREND_ADAPTER, {
        stationExternalId: station.externalId,
        level,
        unit: station.unit,
        observedAt: new Date(t),
      });
      written += 1;
    }
    return written;
  }

  /** Called ~every 30s while trends are active — advances each rising station
   *  by risePerHr × elapsed time since its last reading, respecting the rate
   *  floor (an instant double-write would null the rate again). */
  async stepTrends(now = new Date()): Promise<void> {
    if (!this.trends.size) return;
    for (const [id, job] of [...this.trends]) {
      const station = await prisma.station.findUnique({ where: { id } });
      if (!station) {
        this.trends.delete(id);
        continue;
      }
      const last = await prisma.reading.findFirst({
        where: { stationId: id },
        orderBy: { observedAt: "desc" },
      });
      if (!last) continue;
      const dtH = (now.getTime() - last.observedAt.getTime()) / 3_600_000;
      if (dtH < 2 / 60) continue; // wait out the rate floor
      const next = last.level + job.risePerHr * dtH;
      await this.ingestReading(TREND_ADAPTER, {
        stationExternalId: station.externalId,
        level: next,
        unit: station.unit,
        observedAt: now,
      });
      if (now.getTime() >= job.deadline) this.trends.delete(id);
    }
  }

  private ensureTrendTimer(): void {
    if (this.trendTimer) return;
    this.trendTimer = setInterval(() => {
      this.stepTrends().catch((e) => console.error("[trend]", (e as Error).message));
      if (!this.trends.size && this.trendTimer) {
        clearInterval(this.trendTimer);
        this.trendTimer = null;
      }
    }, 30_000);
  }

  /** Emit live station + alert updates after a new reading lands. */
  private async afterIngest(
    station: Station,
    r: AdapterReading,
    riskScore: number,
    category: string,
    rateOfRise: number | null
  ): Promise<void> {
    await maybeAlertForStation(station, {
      riskScore,
      category,
      level: r.level,
      rateOfRise,
    });
    const dto = await getStationDTO(station.id);
    if (dto) emit("station:update", dto);
  }
}

export const syncService = new SyncService();