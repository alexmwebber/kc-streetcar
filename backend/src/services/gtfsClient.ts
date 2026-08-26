import pkg from "gtfs-realtime-bindings";
const { transit_realtime } = pkg;
import { config } from "../config.js";
import type { VehiclePosition } from "../types/vehicle.js";

export async function fetchStreetcarPositions(): Promise<VehiclePosition[]> {
  const response = await fetch(config.gtfsRtUrl, {
    headers: { Authorization: config.swiftlyApiKey },
  });

  if (!response.ok) {
    throw new Error(`GTFS-RT feed request failed: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

  const positions: VehiclePosition[] = [];

  for (const entity of feed.entity) {
    const vehicle = entity.vehicle;
    if (!vehicle?.position || vehicle.trip?.routeId !== config.streetcarRouteId) {
      continue;
    }

    positions.push({
      vehicleId: vehicle.vehicle?.id ?? entity.id,
      vehicleLabel: vehicle.vehicle?.label ?? undefined,
      tripId: vehicle.trip?.tripId ?? undefined,
      routeId: vehicle.trip.routeId,
      directionId: vehicle.trip?.directionId ?? undefined,
      latitude: vehicle.position.latitude,
      longitude: vehicle.position.longitude,
      bearing: vehicle.position.bearing ?? undefined,
      speedMps: vehicle.position.speed ?? undefined,
      currentStatus: vehicle.currentStatus != null ? String(vehicle.currentStatus) : undefined,
      stopId: vehicle.stopId ?? undefined,
      occupancyPercentage: vehicle.occupancyPercentage ?? undefined,
      feedTimestamp: new Date(Number(vehicle.timestamp ?? feed.header.timestamp) * 1000),
    });
  }

  return positions;
}
