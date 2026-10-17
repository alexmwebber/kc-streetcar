import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  assertRange,
  parseDate,
  parseEnumInt,
  parseIntInRange,
  parseOptionalEnumInt,
  parseTimeOfDay,
} from "../lib/queryParams.js";
import { CACHE_TTL_SECONDS, getCached, setCached } from "../services/analysisCache.js";
import { getProfilePayload, getRunTimePayload } from "../services/analysisService.js";
import { getCoverage } from "../services/speedAnalysisRepository.js";

export const analysisRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_BINS = [50, 100, 200];
const MAX_RANGE_DAYS = 400;

analysisRouter.get(
  "/speed-by-distance",
  asyncHandler(async (req, res) => {
    const to = parseDate(req.query.to, "to", new Date());
    const from = parseDate(req.query.from, "from", new Date(to.getTime() - 30 * DAY_MS));
    assertRange(from, to, MAX_RANGE_DAYS);

    const binMeters = parseEnumInt(req.query.bin, "bin", ALLOWED_BINS, 100);
    const direction = parseOptionalEnumInt(req.query.direction, "direction", [0, 1]);
    const [todFrom, todTo] = parseTimeOfDay(req.query.todFrom, req.query.todTo);
    const minSamples = parseIntInRange(req.query.minSamples, "minSamples", 1, 1000, 20);

    // Key derivation, window snapping and the cache all live in analysisService so
    // the background warmer computes the exact same key this route reads.
    const payload = await getProfilePayload({ from, to, binMeters, direction, todFrom, todTo, minSamples });

    res.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
    res.json(payload);
  }),
);

analysisRouter.get(
  "/run-times",
  asyncHandler(async (req, res) => {
    const to = parseDate(req.query.to, "to", new Date());
    const from = parseDate(req.query.from, "from", new Date(to.getTime() - 30 * DAY_MS));
    assertRange(from, to, MAX_RANGE_DAYS);

    const direction = parseOptionalEnumInt(req.query.direction, "direction", [0, 1]);
    const [todFrom, todTo] = parseTimeOfDay(req.query.todFrom, req.query.todTo);

    const payload = await getRunTimePayload({ from, to, direction, todFrom, todTo });

    res.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
    res.json(payload);
  }),
);

analysisRouter.get(
  "/coverage",
  asyncHandler(async (_req, res) => {
    const cacheKey = "coverage";
    const cached = getCached(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const coverage = await getCoverage();
    // An hour: this only moves as history accumulates, and it exists to bound the
    // date picker rather than to be live.
    setCached(cacheKey, coverage, 60 * 60 * 1000);
    res.json(coverage);
  }),
);
