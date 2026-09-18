import { config } from "../config.js";
import type { WaterDataAdapter } from "./types.js";
import { UkEaAdapter } from "./ukEA.adapter.js";
import { UsgsAdapter } from "./usgs.adapter.js";
import { SeedAdapter } from "./seed.adapter.js";
import { DemoAdapter } from "./demo.adapter.js";
import { NwdpAdapter } from "./nwdp.adapter.js";

const REGISTRY: Record<string, () => WaterDataAdapter> = {
  ukEA: () => new UkEaAdapter(),
  usgs: () => new UsgsAdapter(),
  seed: () => new SeedAdapter(),
  demo: () => new DemoAdapter(),
  nwdp: () => new NwdpAdapter(),
};

let _adapters: WaterDataAdapter[] | null = null;

/** Active adapters, resolved from the DATA_ADAPTERS env (swappable per deploy). */
export function activeAdapters(): WaterDataAdapter[] {
  if (_adapters) return _adapters;
  _adapters = config.dataAdapters.map((name) => {
    const factory = REGISTRY[name];
    if (!factory) {
      console.warn(`[adapters] unknown adapter "${name}" ignored (known: ${Object.keys(REGISTRY).join(", ")})`);
      return null;
    }
    const a = factory();
    console.log(`   · ${a.description}`);
    return a;
  }).filter((a): a is WaterDataAdapter => a !== null);
  return _adapters;
}