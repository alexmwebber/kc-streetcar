import pkg from "gtfs-realtime-bindings";
const { transit_realtime } = pkg;
import { config } from "../config.js";
import type { StopPrediction } from "../types/prediction.js";

export async function fetchStreetcarPredictions(): Promise<StopPrediction[]> {
  const response = await fetch(config.gtfsRtTripUpdatesUrl, {
    headers: { Authorization: config.swiftlyApiKey },
  });

  if (!response.ok) {
    throw new Error(`GTFS-RT trip updates request failed: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

  const predictions: StopPrediction[] = [];

  for (const entity of feed.entity) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate || tripUpdate.trip?.routeId !== config.streetcarRouteId) {
      continue;
    }

    for (const stopTimeUpdate of tripUpdate.stopTimeUpdate ?? []) {
      const arrivalTime = stopTimeUpdate.arrival?.time ?? stopTimeUpdate.departure?.time;
      if (!stopTimeUpdate.stopId || arrivalTime == null) {
        continue;
      }

      predictions.push({
        stopId: stopTimeUpdate.stopId,
        tripId: tripUpdate.trip?.tripId ?? entity.id,
        vehicleId: tripUpdate.vehicle?.id ?? undefined,
        directionId: tripUpdate.trip?.directionId ?? undefined,
        predictedArrival: new Date(Number(arrivalTime) * 1000),
      });
    }
  }

  return predictions;
}
