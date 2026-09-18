import { Router, type Response } from "express";
import { prisma } from "../db/prisma.js";
import { buildAlertsDTO, buildStationsDTO, nationalStats } from "../services/dto.js";
import { recipientList, toAlertDTO } from "../services/alertDispatcher.js";
import { canAction, stationScopeWhere } from "../services/scope.js";
import { emit } from "../socket.js";
import { optionalAuth, requireAuth, type AuthedRequest } from "./auth.js";

export const router = Router();

// Optional auth: anonymous callers (public demo feed) see everything; a signed-in
// district/agency account sees only alerts for stations inside its jurisdiction.
router.get("/", optionalAuth, async (req: AuthedRequest, res: Response) => {
  const alerts = await buildAlertsDTO(120, stationScopeWhere(req.user));
  res.json({ alerts });
});

// App-wide stats used by the dashboard headline.
router.get("/stats", async (_req, res: Response) => {
  const stations = await buildStationsDTO();
  res.json({ stats: nationalStats(stations) });
});

router.get("/contacts", requireAuth, async (_req: AuthedRequest, res: Response) => {
  const { contacts } = await recipientList();
  res.json({ contacts, note: "Demo recipient list. Not an NDRF/NDMA integration." });
});

router.post("/:id/acknowledge", requireAuth, async (req: AuthedRequest, res: Response) => {
  const alert = await prisma.alert.findUnique({ where: { id: req.params.id }, include: { station: true } });
  if (!alert) {
    res.status(404).json({ error: "alert not found" });
    return;
  }
  if (!canAction(req.user, alert.station)) {
    res.status(403).json({ error: "outside your jurisdiction" });
    return;
  }
  if (alert.acknowledgedAt) {
    res.json({ alert: toAlertDTO(alert, alert.station) });
    return;
  }
  const updated = await prisma.alert.update({
    where: { id: alert.id },
    data: { acknowledgedAt: new Date(), acknowledgedBy: req.user?.displayName ?? req.user?.email ?? "authority" },
    include: { station: true },
  });
  const dto = toAlertDTO(updated, updated.station);
  emit("alert:acked", dto);
  res.json({ alert: dto });
});
