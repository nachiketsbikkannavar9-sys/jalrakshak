import type { StationKind } from "../../../shared/src/index.js";

/** Station metadata a data source can register with the system. */
export interface StationSeed {
  externalId: string;
  name: string;
  kind: StationKind;
  place: string;
  lat: number;
  lng: number;
  unit: string;
  /** State/region this gauge monitors (Assam, Bihar, Telangana, "United Kingdom", …). */
  region?: string;
  normalLevel: number;
  warningLevel: number;
  dangerLevel: number;
  simulated?: boolean;
  // per-station risk tuning (overrides globals)
  riseNormDivisor?: number;
  weightProximity?: number;
  weightRise?: number;
  weightRain?: number;
  rainfallEnabled?: boolean;
  alertCooldownMin?: number;
}

/** One observed reading from a data source. */
export interface AdapterReading {
  stationExternalId: string;
  level: number;
  unit: string;
  observedAt: Date;
}

/**
 * Every data source implements this interface, so swapping sources is purely
 * a configuration change (DATA_ADAPTERS env). See adapters/index.ts.
 */
export interface WaterDataAdapter {
  readonly name: string;
  readonly description: string;
  fetchStations(): Promise<StationSeed[]>;
  fetchReadings(): Promise<AdapterReading[]>;
}