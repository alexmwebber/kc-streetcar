import { useEffect, useReducer, useRef } from "react";
import type { VehiclePosition } from "../types/vehicle.js";
import { nearestPointOnRoute, snapToRoute } from "./routeMatch.js";

// The live feed only updates every ~15s, so markers would teleport from one
// fix to the next. This hook eases each streetcar from its previous on-screen
// pose to the new one over a short window, re-snapping to the route every frame
// so the glide follows the line through curves rather than cutting the corner.

export interface AnimatedVehicle {
  vehicle: VehiclePosition;
  lat: number;
  lon: number;
  bearing: number;
}

const ANIM_MS = 1200;

interface Pose {
  lat: number;
  lon: number;
  bearing: number;
}

function snappedPose(v: VehiclePosition): Pose {
  const s = snapToRoute(v.latitude, v.longitude, v.bearing ?? null);
  return s
    ? { lat: s.lat, lon: s.lon, bearing: s.bearing }
    : { lat: v.latitude, lon: v.longitude, bearing: v.bearing ?? 0 };
}

// Signed smallest rotation from `from` to `to`, in degrees (−180..180].
function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

const prefersReducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useAnimatedVehicles(vehicles: VehiclePosition[]): AnimatedVehicle[] {
  const posesRef = useRef<Map<string, Pose>>(new Map());
  const rafRef = useRef<number | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const poses = posesRef.current;
    const starts = new Map<string, Pose>();
    const targets = new Map<string, Pose>();

    for (const v of vehicles) {
      const target = snappedPose(v);
      targets.set(v.vehicle_id, target);
      const current = poses.get(v.vehicle_id);
      starts.set(v.vehicle_id, current ?? target);
      // First sighting: pop in at the target, nothing to animate.
      if (!current) poses.set(v.vehicle_id, target);
    }
    for (const id of [...poses.keys()]) {
      if (!targets.has(id)) poses.delete(id);
    }

    if (prefersReducedMotion || starts.size === 0) {
      for (const [id, target] of targets) poses.set(id, target);
      rerender();
      return;
    }

    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ANIM_MS);
      const eased = p * (2 - p); // easeOutQuad
      for (const [id, target] of targets) {
        const start = starts.get(id)!;
        const [lat, lon] = nearestPointOnRoute(
          start.lat + (target.lat - start.lat) * eased,
          start.lon + (target.lon - start.lon) * eased,
        );
        poses.set(id, {
          lat,
          lon,
          bearing: Math.round(start.bearing + shortestAngleDelta(start.bearing, target.bearing) * eased),
        });
      }
      rerender();
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [vehicles]);

  return vehicles.map((v) => {
    const pose = posesRef.current.get(v.vehicle_id) ?? snappedPose(v);
    return { vehicle: v, lat: pose.lat, lon: pose.lon, bearing: pose.bearing };
  });
}
