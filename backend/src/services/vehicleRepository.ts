import { pool } from "../db/pool.js";
import { locateOnRoute } from "../lib/routeGeometry.js";
import type { VehiclePosition } from "../types/vehicle.js";

export async function insertPosition(position: VehiclePosition): Promise<void> {
  // Chainage is derived here rather than in the poller so it can't be skipped by a
  // future call site - this repository is the single write path into the table.
  // Stored unconditionally, even for fixes far off the line: route_offset_m is what
  // queries filter on, which keeps the off-route threshold a query-time decision.
  const { pathIdx, distAlongM, offsetM } = locateOnRoute(position.latitude, position.longitude);

  await pool.query(
    `INSERT INTO vehicle_positions
      (vehicle_id, vehicle_label, trip_id, route_id, direction_id,
       latitude, longitude, bearing, speed_mps, current_status, stop_id,
       occupancy_percentage, feed_timestamp,
       dist_along_route_m, route_offset_m, route_path_idx)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      position.vehicleId,
      position.vehicleLabel ?? null,
      position.tripId ?? null,
      position.routeId,
      position.directionId ?? null,
      position.latitude,
      position.longitude,
      position.bearing ?? null,
      position.speedMps ?? null,
      position.currentStatus ?? null,
      position.stopId ?? null,
      position.occupancyPercentage ?? null,
      position.feedTimestamp,
      distAlongM,
      offsetM,
      pathIdx,
    ],
  );
}

// Vehicles report roughly every 15s; anything not heard from in this window
// has gone out of service and shouldn't linger on the live map.
const LIVE_STALE_AFTER = "5 minutes";

export async function getLatestPositions() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (vehicle_id) *
     FROM vehicle_positions
     WHERE feed_timestamp > now() - $1::interval
     ORDER BY vehicle_id, feed_timestamp DESC`,
    [LIVE_STALE_AFTER],
  );
  return rows;
}

export async function getPositionHistory(vehicleId: string, since: Date) {
  const { rows } = await pool.query(
    `SELECT * FROM vehicle_positions
     WHERE vehicle_id = $1 AND feed_timestamp >= $2
     ORDER BY feed_timestamp ASC`,
    [vehicleId, since],
  );
  return rows;
}

export async function getAverageSpeed(since: Date) {
  const { rows } = await pool.query(
    `SELECT vehicle_id, AVG(speed_mps) AS avg_speed_mps
     FROM vehicle_positions
     WHERE feed_timestamp >= $1 AND speed_mps IS NOT NULL
     GROUP BY vehicle_id`,
    [since],
  );
  return rows;
}
