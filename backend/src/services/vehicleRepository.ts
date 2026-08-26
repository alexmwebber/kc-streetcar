import { pool } from "../db/pool.js";
import type { VehiclePosition } from "../types/vehicle.js";

export async function insertPosition(position: VehiclePosition): Promise<void> {
  await pool.query(
    `INSERT INTO vehicle_positions
      (vehicle_id, vehicle_label, trip_id, route_id, direction_id,
       latitude, longitude, bearing, speed_mps, current_status, stop_id,
       occupancy_percentage, feed_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
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
    ],
  );
}

export async function getLatestPositions() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (vehicle_id) *
     FROM vehicle_positions
     ORDER BY vehicle_id, feed_timestamp DESC`,
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
