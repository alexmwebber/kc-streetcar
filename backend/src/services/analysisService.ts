import { CANONICAL_PATH, PATH_LENGTHS_M, STOP_CHAINAGE } from "../lib/routeGeometry.js";
import { getCached, setCached } from "./analysisCache.js";
import { getSpeedProfile, SPEED_CAP } from "./speedAnalysisRepository.js";

// One place that turns a request for the speed/occupancy profile into a payload,
// cache included. The HTTP route and the background warmer both go through here so
// they cannot disagree about the cache key - if they did, the warmer would fill a
// slot nothing ever reads.

const HOUR_MS = 60 * 60 * 1000;

/**
 * Requests are snapped to a 6-hour grid before they are used - for the cache key
 * AND for the query itself.
 *
 * Without this the cache is decorative: the page sends `to = new Date()` on every
 * load, so at millisecond precision every visitor produces a unique key, misses,
 * and queries Postgres. That matters more than it sounds, because each query wakes
 * the Neon compute and holds it awake for its idle timer.
 *
 * Snapping costs up to 6 hours of freshness on a multi-week average, which is
 * negligible - and the payload carries `computedAt` so the page can say so rather
 * than quietly lagging.
 */
export const WINDOW_BUCKET_MS = 6 * HOUR_MS;

export function snapToBucket(date: Date): Date {
  return new Date(Math.floor(date.getTime() / WINDOW_BUCKET_MS) * WINDOW_BUCKET_MS);
}

export interface ProfileRequest {
  from: Date;
  to: Date;
  binMeters: number;
  direction: number | null;
  todFrom: string | null;
  todTo: string | null;
  minSamples: number;
}

/** Snap a request's window to the bucket grid, keeping from < to. */
export function normalizeRequest(req: ProfileRequest): ProfileRequest {
  const to = snapToBucket(req.to);
  let from = snapToBucket(req.from);
  // A sub-bucket window can collapse to zero once both ends are floored.
  if (from >= to) from = new Date(to.getTime() - WINDOW_BUCKET_MS);
  return { ...req, from, to };
}

export function cacheKeyFor(req: ProfileRequest): string {
  return JSON.stringify([
    "speed-by-distance",
    req.from.toISOString(),
    req.to.toISOString(),
    req.binMeters,
    req.direction,
    req.todFrom,
    req.todTo,
    req.minSamples,
  ]);
}

/** The view the page loads with. Warmed in the background so the common case is
 *  served from memory and never touches the database. */
export function defaultProfileRequest(): ProfileRequest {
  const to = snapToBucket(new Date());
  return {
    from: new Date(to.getTime() - 30 * 24 * HOUR_MS),
    to,
    binMeters: 100,
    direction: null,
    todFrom: null,
    todTo: null,
    minSamples: 20,
  };
}

export async function getProfilePayload(request: ProfileRequest): Promise<unknown> {
  const req = normalizeRequest(request);
  const key = cacheKeyFor(req);

  const cached = getCached(key);
  if (cached) return cached;

  const bins = await getSpeedProfile(req);
  const payload = {
    binMeters: req.binMeters,
    routeLengthM: PATH_LENGTHS_M[CANONICAL_PATH],
    speedCapMps: SPEED_CAP,
    minSamples: req.minSamples,
    stops: STOP_CHAINAGE,
    // Surfaced on the page: with a 6-hour grid the numbers are deliberately a
    // little behind, and saying so is better than looking live and not being.
    computedAt: new Date().toISOString(),
    filters: {
      from: req.from.toISOString(),
      to: req.to.toISOString(),
      todFrom: req.todFrom,
      todTo: req.todTo,
      direction: req.direction,
    },
    bins,
  };

  setCached(key, payload);
  return payload;
}
