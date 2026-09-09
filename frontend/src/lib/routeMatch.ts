import streetcarRoute from "../data/streetcarRoute.json";

// Map-matching for streetcar positions: the raw GTFS-RT feed reports GPS
// lat/long and a GPS-derived bearing, both of which scatter by a few dozen
// metres/degrees. We snap each vehicle onto the nearest point of the known
// route geometry and take the heading from the route segment itself, so the
// markers sit on the line and their direction indicator follows the track.

type LatLng = [number, number];

const PATHS = streetcarRoute.paths as LatLng[][];

const DEG2RAD = Math.PI / 180;

// Local equirectangular projection around KC — good enough for planar
// distance/projection math at city scale (sub-metre error over the route).
const LAT0 = 39.08 * DEG2RAD;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = Math.cos(LAT0) * 111_320;

// Beyond this, treat the vehicle as genuinely off-route (deadheading, GPS
// glitch) and don't snap — better a floating marker than one teleported
// across the loop.
const MAX_SNAP_METERS = 120;

interface Segment {
  a: LatLng;
  b: LatLng;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  lenSq: number;
  bearing: number; // forward bearing a -> b, degrees clockwise from north
}

function initialBearing(a: LatLng, b: LatLng): number {
  const lat1 = a[0] * DEG2RAD;
  const lat2 = b[0] * DEG2RAD;
  const dLon = (b[1] - a[1]) * DEG2RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG2RAD + 360) % 360;
}

// Pre-project every segment of every path once at module load.
const SEGMENTS: Segment[] = PATHS.flatMap((path) => {
  const segs: Segment[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const ax = a[1] * M_PER_DEG_LON;
    const ay = a[0] * M_PER_DEG_LAT;
    const bx = b[1] * M_PER_DEG_LON;
    const by = b[0] * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    segs.push({ a, b, ax, ay, bx, by, lenSq: dx * dx + dy * dy, bearing: initialBearing(a, b) });
  }
  return segs;
});

function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export interface SnappedPosition {
  lat: number;
  lon: number;
  /** Forward bearing of the matched segment. Not resolved to a travel
   *  direction — the segment could be run either way; callers disambiguate. */
  segmentBearing: number;
}

interface Match {
  seg: Segment;
  t: number; // 0..1 position along the segment
  distMeters: number;
}

/** Nearest point on the whole route to (lat, lon), by planar projection. */
function nearestSegment(lat: number, lon: number): Match {
  const px = lon * M_PER_DEG_LON;
  const py = lat * M_PER_DEG_LAT;

  let bestSeg: Segment = SEGMENTS[0];
  let bestT = 0;
  let bestDistSq = Infinity;

  for (const seg of SEGMENTS) {
    const apx = px - seg.ax;
    const apy = py - seg.ay;
    const t = seg.lenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * (seg.bx - seg.ax) + apy * (seg.by - seg.ay)) / seg.lenSq));
    const qx = seg.ax + t * (seg.bx - seg.ax);
    const qy = seg.ay + t * (seg.by - seg.ay);
    const dx = px - qx;
    const dy = py - qy;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestSeg = seg;
      bestT = t;
    }
  }

  return { seg: bestSeg, t: bestT, distMeters: Math.sqrt(bestDistSq) };
}

function pointAt({ seg, t }: Match): [number, number] {
  return [seg.a[0] + t * (seg.b[0] - seg.a[0]), seg.a[1] + t * (seg.b[1] - seg.a[1])];
}

/**
 * Snap a raw GPS position onto the route. Returns the on-line position and the
 * matched segment's forward bearing (see SnappedPosition). Returns null when
 * the vehicle is further than MAX_SNAP_METERS from the route.
 */
export function snapToRoute(lat: number, lon: number): SnappedPosition | null {
  const match = nearestSegment(lat, lon);
  if (match.distMeters > MAX_SNAP_METERS) return null;

  const [snappedLat, snappedLon] = pointAt(match);
  return { lat: snappedLat, lon: snappedLon, segmentBearing: match.seg.bearing };
}

/**
 * Snap a fixed point (e.g. a stop/station) onto the route line
 * unconditionally — no distance cap, since stops are known to lie on the route.
 */
export function nearestPointOnRoute(lat: number, lon: number): [number, number] {
  return pointAt(nearestSegment(lat, lon));
}

/** Planar distance in metres between two lat/lon points (KC-local projection). */
export function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dx = (bLon - aLon) * M_PER_DEG_LON;
  const dy = (bLat - aLat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Compass bearing (deg) from point A to point B. */
export function headingBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return initialBearing([aLat, aLon], [bLat, bLon]);
}

/**
 * Orient a track's forward bearing to a reference direction: returns
 * `segmentBearing` or `segmentBearing + 180`, whichever points the same way as
 * `reference` (within 90°).
 */
export function alignToTrack(segmentBearing: number, reference: number): number {
  return angularDiff(segmentBearing, reference) > 90 ? (segmentBearing + 180) % 360 : segmentBearing;
}
