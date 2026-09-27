import type { VehiclePosition } from "../types/vehicle.js";

// Converts the internal camelCase position into the snake_case shape the frontend
// expects from /api/vehicles/live.
//
// This used to happen by accident: the endpoint did `SELECT *`, so Postgres's
// column names were the API contract. Serving from the in-memory buffer means
// nothing performs that conversion any more, so it has to be explicit.
//
// The fields here mirror frontend/src/types/vehicle.ts exactly. That type is the
// contract - the old endpoint also leaked id, stop_id, recorded_at and the
// chainage columns simply because they were in the row, but nothing consumed them.

export interface ApiVehiclePosition {
  vehicle_id: string;
  vehicle_label: string | null;
  trip_id: string | null;
  route_id: string;
  direction_id: number | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speed_mps: number | null;
  current_status: string | null;
  occupancy_percentage: number | null;
  /** ISO 8601. Previously produced by pg serialising a timestamptz column. */
  feed_timestamp: string;
}

export function toApiShape(position: VehiclePosition): ApiVehiclePosition {
  return {
    vehicle_id: position.vehicleId,
    vehicle_label: position.vehicleLabel ?? null,
    trip_id: position.tripId ?? null,
    route_id: position.routeId,
    direction_id: position.directionId ?? null,
    latitude: position.latitude,
    longitude: position.longitude,
    bearing: position.bearing ?? null,
    speed_mps: position.speedMps ?? null,
    current_status: position.currentStatus ?? null,
    occupancy_percentage: position.occupancyPercentage ?? null,
    feed_timestamp: position.feedTimestamp.toISOString(),
  };
}
