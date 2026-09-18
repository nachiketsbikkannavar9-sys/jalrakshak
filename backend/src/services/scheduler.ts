import cron from "node-cron";
import { config } from "../config.js";
import { syncService } from "./syncService.js";

let started = false;

/** Poll every POLL_INTERVAL_MIN minutes (node-cron, inside this process). */
export function startScheduler() {
  if (started) return;
  started = true;
  const exp = `*/${Math.max(1, Math.min(59, Math.round(config.pollIntervalMin)))} * * * *`;
  cron.schedule(exp, () => {
    syncService.syncAll().catch((e) => console.error("[scheduler]", (e as Error).message));
  });
  console.log(`[scheduler] polling every ${config.pollIntervalMin} min (${exp})`);
}