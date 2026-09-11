import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { vehiclesRouter } from "./routes/vehicles.js";
import { startPoller } from "./services/poller.js";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use("/api/vehicles", vehiclesRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

startPoller();
