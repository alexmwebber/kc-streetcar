export interface StopPrediction {
  stopId: string;
  tripId: string;
  vehicleId?: string;
  directionId?: number;
  predictedArrival: string;
}
