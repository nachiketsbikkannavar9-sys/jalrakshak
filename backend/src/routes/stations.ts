import { Router, type Request, type Response } from "express";
import { buildHistory, buildStationsAndStats, getStationDTO } from "../services/dto.js";

export const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const { stations, stats } = await buildStationsAndStats();
    res.json({ stations, stats });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  const dto = await getStationDTO(req.params.id);
  if (!dto) {
    res.status(404).json({ error: "station not found" });
    return;
  }
  res.json({ station: dto });
});

router.get("/:id/history", async (req: Request, res: Response) => {
  const hours = Math.max(1, Math.min(720, Number(req.query.hours ?? 24)));
  try {
    const result = await buildHistory(req.params.id, hours);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});