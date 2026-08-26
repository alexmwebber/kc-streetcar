import { Router } from "express";
import { getAverageSpeed, getLatestPositions, getPositionHistory } from "../services/vehicleRepository.js";

export const vehiclesRouter = Router();

vehiclesRouter.get("/live", async (_req, res) => {
  const positions = await getLatestPositions();
  res.json(positions);
});

vehiclesRouter.get("/:vehicleId/history", async (req, res) => {
  const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const history = await getPositionHistory(req.params.vehicleId, since);
  res.json(history);
});

vehiclesRouter.get("/stats/average-speed", async (req, res) => {
  const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stats = await getAverageSpeed(since);
  res.json(stats);
});
