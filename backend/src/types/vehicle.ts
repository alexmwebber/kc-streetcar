export interface VehiclePosition {
  vehicleId: string;
  vehicleLabel?: string;
  tripId?: string;
  routeId: string;
  directionId?: number;
  latitude: number;
  longitude: number;
  bearing?: number;
  speedMps?: number;
  currentStatus?: string;
  stopId?: string;
  occupancyPercentage?: number;
  feedTimestamp: Date;
}
