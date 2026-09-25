import { readFileSync } from "node:fs";

// Linear referencing ("chainage") against the known streetcar alignment: given a
// GPS fix, how far along the route is it, and how far off the line did it land.
// The poller stores both on every row so the speed heatmap is a plain GROUP BY
// instead of re-projecting 300k points per request.
//
// The projection math mirrors frontend/src/lib/routeMatch.ts deliberately - that
// file map-matches for the live map and this one measures distance for analytics,
// so they share constants but not code (the two features are independent, and the
// frontend can't be imported from here anyway: the Docker build context is
// ./backend). The route JSON is a byte copy; `npm run check:geometry` warns if the
// two drift apart.

type LatLng = [number, number];

// Read at runtime rather than `import ... with { type: "json" }` so the JSON stays
// out of the TS module graph - tsc doesn't emit it, so the Dockerfile copies
// src/data alongside the compiled output (see the COPY next to db/migrations).
const routeUrl = new URL("../data/streetcarRoute.json", import.meta.url);
const { paths, stops } = JSON.parse(readFileSync(routeUrl, "utf8")) as {
  paths: LatLng[][];
  stops: { name: string; lat: number; lon: number; stopIds: string[] }[];
};

const DEG2RAD = Math.PI / 180;

// Local equirectangular projection around KC - sub-metre error at city scale.
const LAT0 = 39.08 * DEG2RAD;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = Math.cos(LAT0) * 111_320;

interface Segment {
  a: LatLng;
  b: LatLng;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  lenSq: number;
  len: number;
  /** Cumulative distance from the start of this path to point `a`. */
  cumStart: number;
}

function buildPath(path: LatLng[]): Segment[] {
  const segments: Segment[] = [];
  let cumStart = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const ax = a[1] * M_PER_DEG_LON;
    const ay = a[0] * M_PER_DEG_LAT;
    const bx = b[1] * M_PER_DEG_LON;
    const by = b[0] * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const len = Math.sqrt(lenSq);

    segments.push({ a, b, ax, ay, bx, by, lenSq, len, cumStart });
    cumStart += len;
  }

  return segments;
}

// Pre-project every segment of every path once at module load (~780 total).
const PATHS: Segment[][] = paths.map(buildPath);

export const PATH_LENGTHS_M: number[] = PATHS.map((segments) => {
  const last = segments[segments.length - 1];
  return last.cumStart + last.len;
});

// The two polylines are the two tracks, both running north (Riverfront) to south
// (UMKC). 379 of their 391 vertices are BYTE-IDENTICAL: they diverge only at
// indices 71-82, the one-way River Market loop, by up to 178 m.
//
// That identity is load-bearing for locateOnRoute(). Over the ~97% of the route
// where the lines coincide, both paths produce bit-identical offsets, so the
// strict `<` comparison there always keeps paths[0] - deterministically, with no
// flicker between adjacent fixes. Only inside the loop does a path genuinely win,
// and there it wins because the vehicle really is on that alignment (measured:
// path 1 matches fall entirely within chainage 1264-1757 m and are 1398 direction-1
// vs 4 direction-0). This is why grouping by (path, bin) doesn't fragment a bin's
// samples outside the loop. Changing the tie-break or de-duplicating the shared
// vertices would break that property.
//
// Note the paths do NOT correspond to direction_id in general - direction always
// comes from the column, never from which path matched.
//
// paths[1] is the reference line for the profile chart's x-axis.
export const CANONICAL_PATH = 1;

export interface RouteLocation {
  /** Which polyline matched: the loop legs diverge by up to ~178 m, so the
   *  heatmap draws each bin on the alignment the vehicle was actually on. */
  pathIdx: number;
  /** Metres from the north end of that path. */
  distAlongM: number;
  /** Perpendicular distance from the line - how much to trust the match. */
  offsetM: number;
}

function locateOnPath(segments: Segment[], px: number, py: number) {
  let bestDistSq = Infinity;
  let bestChainage = 0;

  for (const seg of segments) {
    const t =
      seg.lenSq === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((px - seg.ax) * (seg.bx - seg.ax) + (py - seg.ay) * (seg.by - seg.ay)) / seg.lenSq),
          );
    const qx = seg.ax + t * (seg.bx - seg.ax);
    const qy = seg.ay + t * (seg.by - seg.ay);
    const dx = px - qx;
    const dy = py - qy;
    const distSq = dx * dx + dy * dy;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestChainage = seg.cumStart + t * seg.len;
    }
  }

  return { distAlongM: bestChainage, offsetSq: bestDistSq };
}

/**
 * Match a point against both paths; the nearer one wins. Never returns null -
 * callers filter on `offsetM` instead, so the off-route threshold stays a query
 * decision rather than being baked into the stored data.
 */
export function locateOnRoute(lat: number, lon: number): RouteLocation {
  const px = lon * M_PER_DEG_LON;
  const py = lat * M_PER_DEG_LAT;

  let bestIdx = 0;
  let best = locateOnPath(PATHS[0], px, py);

  for (let i = 1; i < PATHS.length; i++) {
    const candidate = locateOnPath(PATHS[i], px, py);
    if (candidate.offsetSq < best.offsetSq) {
      best = candidate;
      bestIdx = i;
    }
  }

  return { pathIdx: bestIdx, distAlongM: best.distAlongM, offsetM: Math.sqrt(best.offsetSq) };
}

// 6 decimal places is ~0.11 m at this latitude - far finer than the ~7 m median GPS
// offset these lines are drawn against, and it roughly halves the JSON payload,
// which matters because the API has no gzip middleware.
const COORD_DP = 1e6;
function round6(coord: LatLng): LatLng {
  return [Math.round(coord[0] * COORD_DP) / COORD_DP, Math.round(coord[1] * COORD_DP) / COORD_DP];
}

/** Point at a given chainage along a path, interpolating within the segment. */
function pointAtChainage(segments: Segment[], distM: number): LatLng {
  const total = segments[segments.length - 1].cumStart + segments[segments.length - 1].len;
  const clamped = Math.max(0, Math.min(total, distM));

  // Segments are ordered by cumStart, so binary search for the one containing it.
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].cumStart <= clamped) lo = mid;
    else hi = mid - 1;
  }

  const seg = segments[lo];
  const t = seg.len === 0 ? 0 : (clamped - seg.cumStart) / seg.len;
  return [seg.a[0] + t * (seg.b[0] - seg.a[0]), seg.a[1] + t * (seg.b[1] - seg.a[1])];
}

/**
 * The drawable polyline between two chainages: both interpolated endpoints plus
 * every real vertex in between, so the ribbon follows the track's actual curves.
 * The API returns these so the analysis page needs no geometry of its own.
 */
export function sliceByChainage(pathIdx: number, fromM: number, toM: number): LatLng[] {
  const segments = PATHS[pathIdx];
  if (!segments) return [];

  const coords: LatLng[] = [round6(pointAtChainage(segments, fromM))];

  for (const seg of segments) {
    const vertexAt = seg.cumStart + seg.len;
    if (vertexAt > fromM && vertexAt < toM) {
      coords.push(round6(seg.b));
    }
  }

  coords.push(round6(pointAtChainage(segments, toM)));
  return coords;
}

/** Stop positions on the canonical path, for the profile chart's x-axis. */
export const STOP_CHAINAGE: { name: string; distM: number }[] = stops
  .map((stop) => ({
    name: stop.name,
    distM: locateOnPath(PATHS[CANONICAL_PATH], stop.lon * M_PER_DEG_LON, stop.lat * M_PER_DEG_LAT).distAlongM,
  }))
  .sort((a, b) => a.distM - b.distM);
