import type { StopPrediction } from "../types/prediction.js";

// In-memory only: predictions are ephemeral (last poll wins) and the backend
// runs pinned to a single replica, so there's no cross-instance consistency
// concern that would justify persisting them.
let predictions: StopPrediction[] = [];

export function setPredictions(next: StopPrediction[]): void {
  predictions = next;
}

export function getPredictions(): StopPrediction[] {
  return predictions;
}
