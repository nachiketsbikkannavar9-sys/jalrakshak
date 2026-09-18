import type { AdapterReading, StationSeed, WaterDataAdapter } from "./types.js";
import { INDIAN_STATIONS } from "./demoStations.js";

/**
 * Scripted demo scenario for the alert loop.
 *
 * "Brahmaputra at Guwahati" rises steadily from just under its warning
 * threshold, crossing into Warning roughly 40 minutes after boot — or
 * instantly when the authority console presses "trigger demo spike". The
 * other Indian stations sit near-normal. Nothing here is real telemetry.
 */
const startRef = Date.now();

export class DemoAdapter implements WaterDataAdapter {
  readonly name = "demo";
  readonly description =
    "Simulated Indian stations with a scripted flood scenario (Brahmaputra rises past its warning threshold). Never real telemetry — clearly labelled SIMULATED in the app.";

  async fetchStations(): Promise<StationSeed[]> {
    return INDIAN_STATIONS;
  }

  async fetchReadings(): Promise<AdapterReading[]> {
    const t = (Date.now() - startRef) / 1000;
    const tMin = t / 60;

    const levelFor = (s: StationSeed): number => {
      let level: number;
      switch (s.externalId) {
        case "brahmaputra-guwahati":
          // 46.7 at boot, +0.045 m/min -> crosses warning 48.5 at ~40 min.
          level = 46.7 + 0.045 * Math.min(tMin, 80) + 0.02 * Math.sin(t / 90);
          break;
        case "godavari-polavaram":
          level = s.normalLevel + 0.12 + 0.008 * Math.min(tMin, 120);
          break;
        case "mahanadi-naraj":
          level = s.normalLevel + 0.22 + 0.06 * Math.sin(t / 240);
          break;
        case "teesta-domohani":
          level = s.normalLevel + 0.3 + 0.1 * Math.sin(t / 150);
          break;
        default:
          level = s.normalLevel + 0.3 + 0.04 * Math.sin(t / 300);
      }
      return Math.round(level * 1000) / 1000;
    };

    return INDIAN_STATIONS.map((s) => ({
      stationExternalId: s.externalId,
      level: levelFor(s),
      unit: s.unit,
      observedAt: new Date(),
    }));
  }
}