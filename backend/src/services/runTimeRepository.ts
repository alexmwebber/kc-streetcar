import { pool } from "../db/pool.js";
import { STOP_CHAINAGE } from "../lib/routeGeometry.js";

// End-to-end run times: how long a streetcar takes to get from one terminal to the
// other - the data behind the run-time histogram.
//
// A "run" is one trip INSTANCE, not one trip_id. Swiftly's trip_ids are schedule
// ids and repeat every service day, so grouping on trip_id alone stitches a month
// of departures into one "trip" that lasts weeks. Per vehicle, ordered by time, a
// new instance starts whenever trip_id or direction changes, or the feed goes quiet
// for longer than INSTANCE_BREAK_GAP.
//
// Run time is measured terminal-zone to terminal-zone:
//
//   departed = the LAST fix inside the origin terminal zone
//   arrived  = the FIRST fix inside the destination terminal zone
//
// Taking the last origin fix rather than the first fix of the trip is what keeps
// the layover out: the trip_id usually flips while the car is still sitting at the
// terminal, and that wait is not part of the ride. Only instances that reach both
// zones count, so short-turned trips (e.g. turning back at Union Station during
// track work) drop out on their own instead of showing up as fast runs.
//
// Resolution is the poll interval: each end is accurate to ~15 s.

/** Metres from a terminal stop that counts as "at the terminal". Wide enough that
 *  a 15 s poll can't skip over it at terminal approach speeds, narrow enough that
 *  the River Market / UMKC neighbour stops (>500 m away) are outside it. */
const TERMINAL_ZONE_M = 150;

/** A feed gap longer than this ends a trip instance. Longer than any normal dwell
 *  or signal hold, much shorter than the gap between two days' runs of one trip_id. */
const INSTANCE_BREAK_GAP = "5 minutes";

/** Runs outside this band are data faults (a stuck feed, a vehicle pulled from
 *  service mid-run that kept its trip_id), not run times. Observed runs sit at
 *  26-39 minutes. */
const MIN_RUN_S = 10 * 60;
const MAX_RUN_S = 90 * 60;

/** Window padding, so a run that departs just inside the window still has its
 *  arrival - and a run that departs just before it still has its departure. */
const PAD = "2 hours";

/** Same threshold as the speed analysis and the live map's snapping. */
const MAX_OFFSET_M = 120;

const NORTH_TERMINAL_M = STOP_CHAINAGE.reduce((a, b) => (b.distM < a.distM ? b : a)).distM;
const SOUTH_TERMINAL_M = STOP_CHAINAGE.reduce((a, b) => (b.distM > a.distM ? b : a)).distM;

const SQL = `
WITH raw AS MATERIALIZED (
  SELECT DISTINCT ON (vehicle_id, feed_timestamp)
         vehicle_id, feed_timestamp, trip_id, direction_id, dist_along_route_m, route_offset_m
    FROM vehicle_positions
   WHERE feed_timestamp >= $1::timestamptz - interval '${PAD}'
     AND feed_timestamp <  $2::timestamptz + interval '${PAD}'
     AND direction_id IN (0, 1)
   ORDER BY vehicle_id, feed_timestamp, id
),
marked AS (
  SELECT *, CASE
      WHEN lag(feed_timestamp) OVER v IS NULL                                            THEN 1
      WHEN trip_id      IS DISTINCT FROM lag(trip_id) OVER v                             THEN 1
      WHEN direction_id IS DISTINCT FROM lag(direction_id) OVER v                        THEN 1
      WHEN feed_timestamp - lag(feed_timestamp) OVER v > interval '${INSTANCE_BREAK_GAP}' THEN 1
      ELSE 0 END AS instance_start
    FROM raw
  WINDOW v AS (PARTITION BY vehicle_id ORDER BY feed_timestamp)
),
instances AS (
  SELECT *, sum(instance_start) OVER (PARTITION BY vehicle_id ORDER BY feed_timestamp
                                      ROWS UNBOUNDED PRECEDING) AS instance_id
    FROM marked
),
zoned AS (
  -- Which terminal zone each on-route fix is in, if any. Direction 1 runs north to
  -- south (toward UMKC), so its origin is the north zone; direction 0 the reverse.
  SELECT vehicle_id, instance_id, direction_id, feed_timestamp,
         CASE WHEN dist_along_route_m <= $3::real + ${TERMINAL_ZONE_M} THEN 'N'
              WHEN dist_along_route_m >= $4::real - ${TERMINAL_ZONE_M} THEN 'S'
         END AS zone
    FROM instances
   WHERE dist_along_route_m IS NOT NULL
     AND route_offset_m <= ${MAX_OFFSET_M}
),
runs AS (
  SELECT direction_id,
         max(feed_timestamp) FILTER (WHERE zone = CASE direction_id WHEN 1 THEN 'N' ELSE 'S' END) AS departed,
         min(feed_timestamp) FILTER (WHERE zone = CASE direction_id WHEN 1 THEN 'S' ELSE 'N' END) AS arrived
    FROM zoned
   GROUP BY vehicle_id, instance_id, direction_id
),
kept AS (
  SELECT direction_id, extract(epoch FROM arrived - departed) AS run_s
    FROM runs
   WHERE arrived > departed
     -- Filters apply to the DEPARTURE, so a run belongs to the window and
     -- time-of-day band it started in.
     AND departed >= $1::timestamptz
     AND departed <  $2::timestamptz
     AND ($5::smallint IS NULL OR direction_id = $5::smallint)
     AND ($6::time IS NULL OR
          CASE WHEN $6::time <= $7::time
               THEN (departed AT TIME ZONE 'America/Chicago')::time >= $6::time
                AND (departed AT TIME ZONE 'America/Chicago')::time <  $7::time
               ELSE (departed AT TIME ZONE 'America/Chicago')::time >= $6::time
                 OR (departed AT TIME ZONE 'America/Chicago')::time <  $7::time
          END)
)
SELECT direction_id AS direction, run_s::float8 AS run_s
  FROM kept
 WHERE run_s BETWEEN ${MIN_RUN_S} AND ${MAX_RUN_S}
 ORDER BY direction_id, run_s
`;

export interface RunTimeParams {
  from: Date;
  to: Date;
  direction: number | null;
  todFrom: string | null;
  todTo: string | null;
}

export interface RunTimeDirection {
  direction: number;
  n: number;
  meanS: number;
  medianS: number;
  p10S: number;
  p90S: number;
  /** Run counts per whole minute: `counts[i]` is runs taking [minMinute + i, minMinute + i + 1) minutes. */
  counts: number[];
}

export interface RunTimeHistogram {
  /** Lower edge of the first bucket, shared by both directions so they align. */
  minMinute: number;
  directions: RunTimeDirection[];
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export async function getRunTimes(params: RunTimeParams): Promise<RunTimeHistogram> {
  const client = await pool.connect();
  let rows: { direction: number; run_s: number }[];
  try {
    await client.query("BEGIN");
    // See speedAnalysisRepository: SET LOCAL is the only timeout that survives
    // Neon's PgBouncer transaction pooling.
    await client.query("SET LOCAL statement_timeout = '20s'");
    ({ rows } = await client.query(SQL, [
      params.from,
      params.to,
      NORTH_TERMINAL_M,
      SOUTH_TERMINAL_M,
      params.direction,
      params.todFrom,
      params.todTo,
    ]));
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Bucketed here rather than shipped raw: a year is tens of thousands of runs,
  // and the chart only ever draws per-minute counts.
  const byDirection = new Map<number, number[]>();
  for (const row of rows) {
    const list = byDirection.get(row.direction) ?? [];
    list.push(row.run_s);
    byDirection.set(row.direction, list);
  }
  if (rows.length === 0) return { minMinute: 0, directions: [] };

  const allMinutes = rows.map((r) => Math.floor(r.run_s / 60));
  const minMinute = Math.min(...allMinutes);
  const maxMinute = Math.max(...allMinutes);

  const directions = [...byDirection.entries()]
    .sort(([a], [b]) => a - b)
    .map(([direction, runs]): RunTimeDirection => {
      // Rows arrive ordered by run_s within each direction.
      const counts = new Array<number>(maxMinute - minMinute + 1).fill(0);
      for (const s of runs) counts[Math.floor(s / 60) - minMinute]++;
      return {
        direction,
        n: runs.length,
        meanS: runs.reduce((sum, s) => sum + s, 0) / runs.length,
        medianS: quantile(runs, 0.5),
        p10S: quantile(runs, 0.1),
        p90S: quantile(runs, 0.9),
        counts,
      };
    });

  return { minMinute, directions };
}
