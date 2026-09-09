import { useEffect, useReducer, useRef } from "react";
import type { VehiclePosition } from "../types/vehicle.js";
import {
  alignToTrack,
  headingBetween,
  metersBetween,
  nearestPointOnRoute,
  snapToRoute,
} from "./routeMatch.js";

// The live feed only updates every ~15s, so markers would teleport from one
// fix to the next. This hook eases each streetcar from its previous on-screen
// pose to the new one over a short window, re-snapping to the route every frame
// so the glide follows the line through curves rather than cutting the corner.
//
// It also resolves each vehicle's facing direction from how its position moved
// between polls, not from the feed's `bearing` field — that field is reported as
// 0 whenever a car is stopped, which otherwise flips the marker to face "north"
// for a single poll every time the streetcar pauses at a stop or signal.

export interface AnimatedVehicle {
  vehicle: VehiclePosition;
  lat: number;
  lon: number;
  bearing: number;
}

const ANIM_MS = 1200;
// Inter-poll displacement below this is treated as dwelling (GPS scatter is
// ~5-15 m; a moving streetcar covers far more in 15 s).
const MIN_MOVE_M = 20;
// A parked car's snapped position can still jitter 20-50 m between polls. Only
// re-derive heading from that displacement when the feed also reports motion.
const STOPPED_MPS = 0.5;
// With no prior fix to compare against, only trust the feed's own bearing above
// this speed (m/s) and when it isn't the 0 placeholder emitted at rest.
const MOVING_MPS = 1.5;

interface Pose {
  lat: number;
  lon: number;
  bearing: number;
}

function snapped(v: VehiclePosition): { lat: number; lon: number; segBearing: number } {
  const s = snapToRoute(v.latitude, v.longitude);
  return s
    ? { lat: s.lat, lon: s.lon, segBearing: s.segmentBearing }
    : { lat: v.latitude, lon: v.longitude, segBearing: v.bearing ?? 0 };
}

function headingWithoutHistory(v: VehiclePosition, segBearing: number): number {
  if (v.speed_mps != null && v.speed_mps > MOVING_MPS && v.bearing != null && v.bearing !== 0) {
    return alignToTrack(segBearing, v.bearing);
  }
  return segBearing;
}

function resolveTarget(v: VehiclePosition, prev: Pose | undefined): Pose {
  const { lat, lon, segBearing } = snapped(v);

  if (prev) {
    const moved = metersBetween(prev.lat, prev.lon, lat, lon);
    if (moved >= MIN_MOVE_M && (v.speed_mps ?? 0) > STOPPED_MPS) {
      const travel = headingBetween(prev.lat, prev.lon, lat, lon);
      return { lat, lon, bearing: alignToTrack(segBearing, travel) };
    }
    // Dwelling at a stop / signal — hold the last real heading rather than
    // spinning to face the feed's placeholder bearing.
    return { lat, lon, bearing: prev.bearing };
  }

  return { lat, lon, bearing: headingWithoutHistory(v, segBearing) };
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
  const posesRef = useRef<Map<string, Pose>>(new Map()); // current on-screen pose (mutated per frame)
  const prevTargetsRef = useRef<Map<string, Pose>>(new Map()); // last poll's settled target, for movement-based heading
  const rafRef = useRef<number | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const poses = posesRef.current;
    const prevTargets = prevTargetsRef.current;
    const starts = new Map<string, Pose>();
    const targets = new Map<string, Pose>();

    for (const v of vehicles) {
      const target = resolveTarget(v, prevTargets.get(v.vehicle_id));
      targets.set(v.vehicle_id, target);
      const current = poses.get(v.vehicle_id);
      starts.set(v.vehicle_id, current ?? target);
      // First sighting: pop in at the target, nothing to animate.
      if (!current) poses.set(v.vehicle_id, target);
    }
    for (const id of [...poses.keys()]) {
      if (!targets.has(id)) poses.delete(id);
    }
    prevTargetsRef.current = targets;

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
    const pose =
      posesRef.current.get(v.vehicle_id) ?? resolveTarget(v, prevTargetsRef.current.get(v.vehicle_id));
    return { vehicle: v, lat: pose.lat, lon: pose.lon, bearing: pose.bearing };
  });
}
