import type { VehiclePosition } from "../types/vehicle.js";

// Holds polled positions in memory between database flushes.
//
// WHY: To save on database compute, instead of writing every 15 seconds 
//      this writes every 30 minutes, which allows the computer to scale to zero
//      after 5 minutes of inactivity, instead of always running. 
//
// This is also the single source of truth for /api/vehicles/live, which used to
// read the newest row per vehicle straight from Postgres. It can't any more: the
// newest positions live here for up to a flush interval.
//
// The cost is durability. A hard crash loses whatever hasn't been flushed. That's
// an accepted trade for a historical-analysis dataset, and index.ts flushes on
// SIGTERM so ordinary restarts and deploys lose nothing.
//
// Correctness depends on the backend running a single replica (minReplicas =
// maxReplicas = 1). Two replicas would each hold a partial buffer and /live would
// flip between them.

/** a vehicle not
 *  heard from in this long has gone out of service and shouldn't sit on the map. */
const LIVE_STALE_AFTER_MS = 5 * 60 * 1000;

/** Safety valve. At ~9 vehicles every 15s a 30-minute window is ~1,100 rows, so
 *  this is far above normal - it only matters if flushes fail repeatedly, where
 *  dropping the oldest beats growing until the container is OOM-killed. */
const MAX_PENDING = 20_000;

/** Rows waiting to be written, in arrival order. */
let pending: VehiclePosition[] = [];

/** Newest position per vehicle, for /live. Kept separately because it must survive
 *  a flush draining `pending`. */
const latestByVehicle = new Map<string, VehiclePosition>();

/** Guards against re-buffering a fix we already hold. The upstream feed resends an
 *  identical stale fix for an extra poll cycle now and then (~0.27% of rows), which
 *  used to reach the table and force every analytics query to dedupe. Catching it
 *  here keeps the duplicates out of the database entirely. */
const seen = new Set<string>();

function fixKey(p: VehiclePosition): string {
  return `${p.vehicleId}|${p.feedTimestamp.getTime()}`;
}

export function addPositions(positions: VehiclePosition[]): number {
  let added = 0;

  for (const position of positions) {
    const key = fixKey(position);
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(position);
    added++;

    const current = latestByVehicle.get(position.vehicleId);
    if (!current || position.feedTimestamp > current.feedTimestamp) {
      latestByVehicle.set(position.vehicleId, position);
    }
  }

  if (pending.length > MAX_PENDING) {
    const dropped = pending.length - MAX_PENDING;
    pending = pending.slice(dropped);
    console.error(`[buffer] over ${MAX_PENDING} pending rows - dropped ${dropped} oldest`);
  }

  return added;
}

/** Remove everything pending, for writing. On failure hand it back via restore(). */
export function takePending(): VehiclePosition[] {
  const taken = pending;
  pending = [];
  return taken;
}

/** Return rows to the front of the queue after a failed flush, preserving order. */
export function restorePending(positions: VehiclePosition[]): void {
  pending = positions.concat(pending);
}

export function pendingCount(): number {
  return pending.length;
}

/** Newest position per vehicle, excluding vehicles that have gone quiet. */
export function getLatestPositions(now: Date = new Date()): VehiclePosition[] {
  const cutoff = now.getTime() - LIVE_STALE_AFTER_MS;
  const live: VehiclePosition[] = [];

  for (const [vehicleId, position] of latestByVehicle) {
    if (position.feedTimestamp.getTime() > cutoff) {
      live.push(position);
    } else {
      // Out of service - drop it so the map and this map don't grow forever.
      latestByVehicle.delete(vehicleId);
    }
  }

  // `seen` only needs to cover the window where a resend could still arrive.
  // Clearing it alongside the stale sweep keeps it from growing without bound.
  if (seen.size > MAX_PENDING) seen.clear();

  return live.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
}
