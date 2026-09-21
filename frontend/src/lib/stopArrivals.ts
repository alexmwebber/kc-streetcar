import type { StopPrediction } from "../types/prediction.js";
import { DIRECTION_LABELS } from "./tripDirection.js";

export interface StopArrival {
  label: string;
  etaSeconds: number;
}

/** For a stop's GTFS stop_ids, the soonest predicted arrival per direction. */
export function nextArrivals(stopIds: string[], predictions: StopPrediction[], now: Date): StopArrival[] {
  const arrivals: StopArrival[] = [];

  for (const stopId of stopIds) {
    let soonest: StopPrediction | null = null;
    for (const prediction of predictions) {
      if (prediction.stopId !== stopId) continue;
      if (!soonest || prediction.predictedArrival < soonest.predictedArrival) {
        soonest = prediction;
      }
    }
    if (!soonest) continue;

    const etaSeconds = Math.max(0, Math.round((new Date(soonest.predictedArrival).getTime() - now.getTime()) / 1000));
    const label = soonest.directionId != null ? DIRECTION_LABELS[soonest.directionId] ?? "Next arrival" : "Next arrival";
    arrivals.push({ label, etaSeconds });
  }

  return arrivals.sort((a, b) => a.etaSeconds - b.etaSeconds);
}

export function formatEta(etaSeconds: number): string {
  if (etaSeconds <= 30) return "Arriving now";
  return `${Math.round(etaSeconds / 60)} min`;
}
