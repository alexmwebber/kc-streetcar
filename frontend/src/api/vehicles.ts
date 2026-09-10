import type { VehiclePosition } from "../types/vehicle.js";

// Empty in local dev: requests stay relative and Vite proxies /api to the
// backend (see vite.config.ts). In production builds this is set to the
// deployed API origin at build time.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export async function fetchLivePositions(): Promise<VehiclePosition[]> {
  const res = await fetch(`${API_BASE_URL}/api/vehicles/live`);
  if (!res.ok) {
    throw new Error(`Failed to fetch live positions: ${res.status}`);
  }
  return res.json();
}
