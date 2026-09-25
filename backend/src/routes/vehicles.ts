import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseDate } from "../lib/queryParams.js";
import { getPredictions } from "../services/predictionsStore.js";
import { getAverageSpeed, getLatestPositions, getPositionHistory } from "../services/vehicleRepository.js";

export const vehiclesRouter = Router();

vehiclesRouter.get(
  "/live",
  asyncHandler(async (_req, res) => {
    const positions = await getLatestPositions();
    res.json(positions);
  }),
);

vehiclesRouter.get(
  "/predictions",
  asyncHandler(async (_req, res) => {
    res.json(getPredictions());
  }),
);

vehiclesRouter.get(
  "/:vehicleId/history",
  asyncHandler(async (req, res) => {
    const since = parseDate(req.query.since, "since", new Date(Date.now() - 24 * 60 * 60 * 1000));
    const history = await getPositionHistory(req.params.vehicleId, since);
    res.json(history);
  }),
);

vehiclesRouter.get(
  "/stats/average-speed",
  asyncHandler(async (req, res) => {
    const since = parseDate(req.query.since, "since", new Date(Date.now() - 24 * 60 * 60 * 1000));
    const stats = await getAverageSpeed(since);
    res.json(stats);
  }),
);
