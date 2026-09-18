import { Router, type Response } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { syncService } from "../services/syncService.js";
import { recipientList } from "../services/alertDispatcher.js";
import { canAction } from "../services/scope.js";

export const router = Router();

router.get("/health", async (_req, res: Response) => {
  res.json({ ok: true, uptimeSec: Math.round(process.uptime()), at: new Date().toISOString() });
});

// Demo lever: push a station's water level NOW (writes a real reading,
// recomputes risk server-side, and fires alerts if it crosses Warning).
// Jurisdiction-scoped: a district/agency account may only act inside its
// own region/stations; national/admin accounts act anywhere.
router.post("/simulate", requireAuth, async (req: AuthedRequest, res: Response) => {
  const { stationId, level, delta, mode } = req.body ?? {};
  if (!stationId) {
    res.status(400).json({ error: "stationId required" });
    return;
  }
  try {
    const station = await prisma.station.findUnique({ where: { id: String(stationId) } });
    if (!station) {
      res.status(404).json({ error: "station not found" });
      return;
    }
    if (!canAction(req.user, station)) {
      res.status(403).json({ error: "station outside your jurisdiction" });
      return;
    }
    let targetLevel: number | undefined = level ? Number(level) : undefined;
    if (targetLevel === undefined) {
      if (mode === "past-warning") {
        // Firm, honest breach: 90% of the normal→danger band. Well past the
        // warning threshold by proximity alone (no artificial rate-of-rise),
        // still below the declared danger level.
        targetLevel =
          station.normalLevel +
          0.9 * (station.dangerLevel - station.normalLevel);
      } else {
        const bump = Number(delta ?? 1.2);
        targetLevel = station.normalLevel + bump;
      }
    }
    const result = await syncService.forceReading(String(stationId), targetLevel);
    res.json({
      ok: true,
      ...result,
      note: "Demo tooling: injected reading + recomputed risk server-side. See alert feed.",
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Demo lever #2: a GRADUAL, scripted flood rise — distinct from the instant
// force-spike. Writes readings with real ≥2-min spacing so the "time to
// threshold" projection genuinely appears and tracks the climb. stop=true
// flattens the level (projection clears) without touching the spike tool.
// Jurisdiction-scoped exactly like /simulate.
router.post("/trend", requireAuth, async (req: AuthedRequest, res: Response) => {
  const { stationId, risePerHr, minutes, stop } = req.body ?? {};
  if (!stationId) {
    res.status(400).json({ error: "stationId required" });
    return;
  }
  try {
    const station = await prisma.station.findUnique({ where: { id: String(stationId) } });
    if (!station) {
      res.status(404).json({ error: "station not found" });
      return;
    }
    if (!canAction(req.user, station)) {
      res.status(403).json({ error: "station outside your jurisdiction" });
      return;
    }
    if (stop) {
      const result = await syncService.stopGradualRise(String(stationId));
      res.json({ ok: true, ...result, note: "Gradual rise stopped · level flattened, projection cleared." });
    } else {
      const rate = Number(risePerHr);
      const min = Number(minutes);
      const result = await syncService.startGradualRise(
        String(stationId),
        Number.isFinite(rate) && rate > 0 ? rate : 1.5,
        Number.isFinite(min) && min > 0 ? min : 8
      );
      res.json({
        ok: true,
        ...result,
        note: `"${station.name}" now rising +${Number.isFinite(rate) && rate > 0 ? rate : 1.5} m/h (linear estimate). Watch the projection update.`,
      });
    }
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get("/contacts", requireAuth, async (_req: AuthedRequest, res: Response) => {
  res.json(await recipientList());
});