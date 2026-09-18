import type { AdapterReading, StationSeed, WaterDataAdapter } from "./types.js";
import { INDIAN_STATIONS } from "./demoStations.js";

/**
 * Deterministic offline fallback. Produces stable, always-available readings
 * for the Indian demo stations so the dashboard never shows an empty state
 * even if every external API is unreachable.
 */
const startRef = Date.now();

export class SeedAdapter implements WaterDataAdapter {
  readonly name = "seed";
  readonly description =
    "Deterministic offline fallback readings for the Indian demo stations (stable values, no network required).";

  async fetchStations(): Promise<StationSeed[]> {
    return INDIAN_STATIONS;
  }

  async fetchReadings(): Promise<AdapterReading[]> {
    const t = (Date.now() - startRef) / 1000;
    return INDIAN_STATIONS.map((s) => ({
      stationExternalId: s.externalId,
      level: Math.round((s.normalLevel + 0.15 * Math.sin(t / 1800) + 0.05) * 1000) / 1000,
      unit: s.unit,
      observedAt: new Date(),
    }));
  }
}