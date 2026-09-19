import type {
  ExposureAlertAdvice,
  ExposureExplanation,
  ExposureResult,
  LevelBasis,
  Projection,
  RiskCategory,
} from "../../../shared/src/index.js";
import { get } from "./api";

export interface LocationExposureResponse {
  location: { lat: number; lng: number };
  elevation: {
    elevationM: number | null;
    available: boolean;
    cacheKey: string;
    fetched: boolean;
    error: string | null;
  };
  distanceKm: number | null;
  nearestStation: {
    id: string;
    name: string;
    place: string;
    region: string | null;
    kind: string;
    lat: number;
    lng: number;
    unit: string;
    levelBasis: LevelBasis | null;
    normalLevel: number;
    warningLevel: number;
    dangerLevel: number;
    hazardCategory: RiskCategory | null;
    latest: {
      level: number;
      riskScore: number;
      category: RiskCategory;
      rateOfRise: number | null;
      rainfallMm: number | null;
      observedAt: string;
      projection: Projection | null;
    } | null;
  } | null;
  exposure: ExposureResult;
  explanation: ExposureExplanation;
  advice: ExposureAlertAdvice;
  modelled: boolean;
  fetchedAt: string;
}

export async function getLocationExposure(lat: number, lng: number): Promise<LocationExposureResponse> {
  return get<LocationExposureResponse>(`/api/location/exposure?lat=${lat}&lng=${lng}`);
}

/** A server-selected pair of demo points near the same gauge whose exposures
 *  are meant to land in DIFFERENT risk bands (low ground vs raised ground). */
export interface DemoPoint {
  lat: number;
  lng: number;
  label: string;
  category: RiskCategory;
  score: number;
}

export interface DemoPair {
  station: { id: string; name: string; place: string };
  low: DemoPoint;
  raised: DemoPoint;
  /** True when the two points' exposure categories actually differ (the point
   *  of the demo — the terrain may not always allow it). */
  crossedBands: boolean;
  generatedAt: string;
}

export async function getDemoPair(): Promise<DemoPair> {
  return get<DemoPair>("/api/location/demo");
}
