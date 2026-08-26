import type { VehiclePosition } from "../types/vehicle.js";

export async function fetchLivePositions(): Promise<VehiclePosition[]> {
  const res = await fetch("/api/vehicles/live");
  if (!res.ok) {
    throw new Error(`Failed to fetch live positions: ${res.status}`);
  }
  return res.json();
}
