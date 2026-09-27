import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseDate } from "../lib/queryParams.js";
import { getPredictions } from "../services/predictionsStore.js";
import { getLatestPositions } from "../services/positionBuffer.js";
import { toApiShape } from "../services/vehicleApiShape.js";
import { getAverageSpeed, getPositionHistory } from "../services/vehicleRepository.js";

export const vehiclesRouter = Router();

vehiclesRouter.get(
  "/live",
  asyncHandler(async (_req, res) => {
    // From the in-memory buffer, not the database: the newest positions have not
    // been flushed yet, and reading them would wake the compute on every poll the
    // frontend makes.
    res.json(getLatestPositions().map(toApiShape));
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
