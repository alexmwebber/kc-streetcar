import { pool } from "../db/pool.js";
import { sliceByChainage } from "../lib/routeGeometry.js";

// Average speed per fixed-length stretch of route, split by direction - the data
// behind the speed heatmap.
//
// Three things here are easy to break and expensive to notice:
//
// 1. STATIONARY-RUN DETECTION MUST SEE AN UNFILTERED, CONTIGUOUS SERIES.
//    Terminal layovers are excluded by measuring how long each stationary run
//    lasts, which only works if every consecutive fix (vehicle poll) for a vehicle is present.
//    Applying the user's filters before that step punches holes that silently
//    stitch two separate dwells into one run, or chop a layover so it measures
//    short and survives exclusion. Hence the padded window in `raw`, and the fact
//    that every user filter lands in `kept`, after the window functions.
//
// 2. THE ARITHMETIC MEAN IS THE CORRECT STATISTIC, not the median. Fixes arrive on
//    a fixed ~15 s cadence, so within a bin mean(v) ~= (1/T) * integral of v dt =
//    D/T - exactly the average speed of traversal. The dwell weighting we
//    deliberately keep (slow travel contributes proportionally more samples) falls
//    out for free. A median would discard precisely that weighting. median_mps and
//    stopped_share are hover context only.
//
// 3. TIME-OF-DAY IS LOCAL. feed_timestamp is timestamptz; "rush hour" means
//    America/Chicago. Comparing in UTC shifts every filter by 5-6 hours.
//
// Speed and occupancy are both returned from this one query, over the SAME rows.
// That is deliberate: the page toggles between them, and the two are only
// comparable if the population behind them is identical - same dedup, same layover
// exclusion, same filters. It also means the toggle needs no refetch. The one
// asymmetry is the speed cap, which drops GPS artifacts for reasons that have
// nothing to do with occupancy; it is kept anyway (it costs well under 1% of rows)
// rather than letting the two metrics silently diverge in denominator.

/** Speed above which a fix is a GPS artifact rather than a streetcar. Measured
 *  p99.9 is 22 m/s; the observed max of 30.77 m/s (68.8 mph) is impossible here. */
const SPEED_CAP_MPS = 20;

/** Below this the vehicle counts as stopped, for run detection. */
const STOPPED_MPS = 0.5;

/** A stationary run longer than this is a terminal layover, not a passenger-facing
 *  delay, so it is excluded. Normal stop dwell and red lights stay in. A 15 s feed
 *  means an 8-sample dwell spans 105 s, so this under-measures by about one
 *  interval - read it as "roughly 2.25 minutes of wall clock". */
const LAYOVER_THRESHOLD = "120 seconds";

/** A feed gap longer than this breaks a run, so an overnight absence can't merge a
 *  garage layover into the previous evening's dwell. */
const RUN_BREAK_GAP = "60 seconds";

/** How far off the line a fix may land and still count. Matches the live map's
 *  MAX_SNAP_METERS. */
const MAX_OFFSET_M = 120;

const SQL = `
WITH raw AS MATERIALIZED (
  -- Dedup the ~0.27% upstream stale resends (same vehicle + feed_timestamp, new
  -- row). ORDER BY must lead with the DISTINCT ON keys; id breaks ties.
  -- Window is PADDED past the request and deliberately unfiltered - see note 1.
  SELECT DISTINCT ON (vehicle_id, feed_timestamp)
         id, vehicle_id, feed_timestamp, direction_id, speed_mps, occupancy_percentage,
         dist_along_route_m, route_offset_m, route_path_idx
    FROM vehicle_positions
   WHERE feed_timestamp >= $1::timestamptz - interval '15 minutes'
     AND feed_timestamp <  $2::timestamptz + interval '15 minutes'
     AND speed_mps IS NOT NULL
   ORDER BY vehicle_id, feed_timestamp, id
),
marked AS (
  SELECT *, CASE
      WHEN lag(feed_timestamp) OVER v IS NULL                                        THEN 1
      WHEN feed_timestamp - lag(feed_timestamp) OVER v > interval '${RUN_BREAK_GAP}' THEN 1
      WHEN (speed_mps < ${STOPPED_MPS}) IS DISTINCT FROM
           (lag(speed_mps) OVER v < ${STOPPED_MPS})                                  THEN 1
      ELSE 0 END AS run_start
    FROM raw
  WINDOW v AS (PARTITION BY vehicle_id ORDER BY feed_timestamp)
),
runs AS (
  SELECT *, sum(run_start) OVER (PARTITION BY vehicle_id ORDER BY feed_timestamp
                                 ROWS UNBOUNDED PRECEDING) AS run_id
    FROM marked
),
spans AS (
  SELECT *, max(feed_timestamp) OVER r - min(feed_timestamp) OVER r AS run_span
    FROM runs
  WINDOW r AS (PARTITION BY vehicle_id, run_id)
),
kept AS (
  SELECT route_path_idx AS path,
         floor(dist_along_route_m / $3::int)::int AS bin,
         direction_id,
         speed_mps,
         occupancy_percentage
    FROM spans
   -- Terminal layovers out; normal stop dwell and signals stay in.
   WHERE NOT (speed_mps < ${STOPPED_MPS} AND run_span > interval '${LAYOVER_THRESHOLD}')
     -- Every user-supplied filter applies HERE, after run detection. See note 1.
     AND feed_timestamp >= $1::timestamptz
     AND feed_timestamp <  $2::timestamptz
     AND dist_along_route_m IS NOT NULL
     AND route_offset_m <= ${MAX_OFFSET_M}
     AND speed_mps <= ${SPEED_CAP_MPS}
     AND direction_id IN (0, 1)
     AND ($4::smallint IS NULL OR direction_id = $4::smallint)
     AND ($5::time IS NULL OR
          CASE WHEN $5::time <= $6::time
               -- Normal window, e.g. 07:00-10:00.
               THEN (feed_timestamp AT TIME ZONE 'America/Chicago')::time >= $5::time
                AND (feed_timestamp AT TIME ZONE 'America/Chicago')::time <  $6::time
               -- Wrapped window, e.g. 22:00-02:00.
               ELSE (feed_timestamp AT TIME ZONE 'America/Chicago')::time >= $5::time
                 OR (feed_timestamp AT TIME ZONE 'America/Chicago')::time <  $6::time
          END)
)
SELECT path,
       bin,
       direction_id AS direction,
       count(*)::int                                          AS n,
       avg(speed_mps)                                         AS mean_mps,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY speed_mps) AS median_mps,
       avg((speed_mps < ${STOPPED_MPS})::int)                 AS stopped_share,
       avg(occupancy_percentage)                              AS mean_occupancy,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY occupancy_percentage) AS median_occupancy
  FROM kept
 GROUP BY path, bin, direction
HAVING count(*) >= $7::int
 ORDER BY bin, direction
`;

export interface SpeedProfileParams {
  from: Date;
  to: Date;
  binMeters: number;
  direction: number | null;
  todFrom: string | null;
  todTo: string | null;
  minSamples: number;
}

export interface SpeedBin {
  path: number;
  bin: number;
  direction: number;
  /** Drawable polyline for this stretch, so the frontend needs no geometry. */
  coords: [number, number][];
  /** Chainage of the bin's midpoint, for the profile chart's x-axis. */
  chainageM: number;
  n: number;
  meanMps: number;
  medianMps: number;
  stoppedShare: number;
  /** GTFS-RT occupancy: percentage of SEATS occupied, so it legitimately exceeds
   *  100 when people are standing (observed max 150). Any scale over this has to
   *  allow for that rather than assuming 0-100. */
  meanOccupancy: number;
  medianOccupancy: number;
}

export const SPEED_CAP = SPEED_CAP_MPS;

export async function getSpeedProfile(params: SpeedProfileParams): Promise<SpeedBin[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL inside an explicit transaction is the only timeout mechanism that
    // survives Neon's PgBouncer transaction pooling - a session-level SET would
    // leak to whichever backend the pooler hands out next.
    await client.query("SET LOCAL statement_timeout = '20s'");
    const { rows } = await client.query(SQL, [
      params.from,
      params.to,
      params.binMeters,
      params.direction,
      params.todFrom,
      params.todTo,
      params.minSamples,
    ]);
    await client.query("COMMIT");

    // pg returns avg()/percentile_cont() as strings (numeric), so coerce here
    // rather than letting "4.01" reach the frontend.
    return rows.map((row) => {
      const startM = row.bin * params.binMeters;
      return {
        path: row.path,
        bin: row.bin,
        direction: row.direction,
        coords: sliceByChainage(row.path, startM, startM + params.binMeters),
        chainageM: startM + params.binMeters / 2,
        n: row.n,
        meanMps: Number(row.mean_mps),
        medianMps: Number(row.median_mps),
        stoppedShare: Number(row.stopped_share),
        meanOccupancy: Number(row.mean_occupancy),
        medianOccupancy: Number(row.median_occupancy),
      };
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export interface Coverage {
  firstSample: Date | null;
  lastSample: Date | null;
  rowCount: number;
  locatedRowCount: number;
}

/** Bounds the date picker, and reveals whether the backfill has run. */
export async function getCoverage(): Promise<Coverage> {
  const { rows } = await pool.query(
    `SELECT min(feed_timestamp)        AS first_sample,
            max(feed_timestamp)        AS last_sample,
            count(*)::int              AS row_count,
            count(route_offset_m)::int AS located_row_count
       FROM vehicle_positions`,
  );
  const row = rows[0];
  return {
    firstSample: row.first_sample,
    lastSample: row.last_sample,
    rowCount: row.row_count,
    locatedRowCount: row.located_row_count,
  };
}
