// Dev-only tool: replays a vehicle's recorded position history through the
// exact same heading-resolution logic useAnimatedVehicles.ts ships (imported
// directly, not duplicated, so this can't drift out of sync with it), and
// flags any single-poll reversal — a jump away from the local trend that
// reverts on the next poll. That's the signature of a heading-resolution bug
// (as opposed to a real turn, which keeps going rather than snapping back).
//
// Not wired into the app; run directly with tsx against a saved
// /api/vehicles/:id/history JSON dump, e.g.:
//   npx tsx -e '
//     import { replayHeadings } from "./dev-tools/replayHeadings.js";
//     replayHeadings(JSON.parse(require("fs").readFileSync("history.json", "utf8")), "811");
//   '
// Re-run this whenever the heading logic changes, ideally against a vehicle
// history that spans a full round trip (both termini, both turnback loops).
import { resolveTarget, type Anchor } from "../src/lib/useAnimatedVehicles.js";
import type { VehiclePosition } from "../src/types/vehicle.js";

const REVERSAL_DEG = 60;

function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function replayHeadings(rows: VehiclePosition[], label: string) {
  let prev: Anchor | undefined;
  const resolved: number[] = [];
  const anomalies: { index: number; timestamp: string; from: number; to: number; back: number }[] = [];

  for (const r of rows) {
    const target = resolveTarget(r, prev);
    resolved.push(target.bearing);
    prev = target;
  }

  for (let i = 1; i < resolved.length - 1; i++) {
    const out = shortestAngleDelta(resolved[i - 1], resolved[i]);
    const back = shortestAngleDelta(resolved[i], resolved[i + 1]);
    // Flag a jump away from the trend that mostly reverts on the very next
    // poll — a real turn keeps going; a glitch snaps back.
    if (Math.abs(out) > REVERSAL_DEG && Math.sign(out) !== Math.sign(back) && Math.abs(back) > REVERSAL_DEG * 0.5) {
      anomalies.push({
        index: i,
        timestamp: rows[i].feed_timestamp,
        from: resolved[i - 1],
        to: resolved[i],
        back: resolved[i + 1],
      });
    }
  }

  console.log(`\n=== ${label}: ${rows.length} fixes, lat ${Math.min(...rows.map((r) => r.latitude)).toFixed(4)}-${Math.max(...rows.map((r) => r.latitude)).toFixed(4)} ===`);
  if (anomalies.length === 0) {
    console.log("no single-poll reversals detected");
  } else {
    for (const a of anomalies) {
      console.log(`  ANOMALY at index ${a.index} (${a.timestamp}): ${a.from.toFixed(1)} -> ${a.to.toFixed(1)} -> ${a.back.toFixed(1)}`);
    }
  }
  return anomalies;
}
