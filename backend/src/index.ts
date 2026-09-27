import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { analysisRouter } from "./routes/analysis.js";
import { vehiclesRouter } from "./routes/vehicles.js";
import { startAnalysisWarmer } from "./services/analysisWarmer.js";
import { flushPositions, startPoller } from "./services/poller.js";
import { pendingCount } from "./services/positionBuffer.js";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use("/api/vehicles", vehiclesRouter);
app.use("/api/analysis", analysisRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

startPoller();
startAnalysisWarmer();

// Positions live in memory between flushes, so an unflushed buffer is real data
// waiting to be written. Container Apps sends SIGTERM before replacing a revision,
// so without this every deploy would silently drop up to one flush interval of
// history - and deploys are by far the most common restart.
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, ${pendingCount()} position(s) pending`);

  // Stop taking new requests first so the final flush isn't racing new work.
  server.close();

  try {
    await flushPositions(`${signal} shutdown`);
  } catch (err) {
    console.error("[shutdown] final flush failed:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
