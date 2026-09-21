export interface VehiclePosition {
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
  feed_timestamp: string;
}
