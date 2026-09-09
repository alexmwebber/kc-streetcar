import { Router, type RequestHandler } from "express";
import { getAverageSpeed, getLatestPositions, getPositionHistory } from "../services/vehicleRepository.js";

export const vehiclesRouter = Router();

// Express 4 doesn't catch rejected promises from async handlers, so an unhandled
// rejection (e.g. Postgres is down) leaves the request hanging. Wrap handlers so
// any error becomes a 500 instead.
function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err);
      res.status(500).json({ error: "internal server error" });
    });
  };
}

vehiclesRouter.get(
  "/live",
  asyncHandler(async (_req, res) => {
    const positions = await getLatestPositions();
    res.json(positions);
  }),
);

vehiclesRouter.get(
  "/:vehicleId/history",
  asyncHandler(async (req, res) => {
    const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const history = await getPositionHistory(req.params.vehicleId, since);
    res.json(history);
  }),
);

vehiclesRouter.get(
  "/stats/average-speed",
  asyncHandler(async (req, res) => {
    const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stats = await getAverageSpeed(since);
    res.json(stats);
  }),
);
