import { useEffect, useReducer, useRef } from "react";
import type { VehiclePosition } from "../types/vehicle.js";
import { alignToTrack, headingBetween, metersBetween, nearestPointOnRoute, snapToRoute } from "./routeMatch.js";
import { directionReferenceBearing } from "./tripDirection.js";

// The live GTFS-RT feed only updates every ~15s, so markers would otherwise
// teleport from one fix to the next. This hook eases each streetcar from its
// previous on-screen pose to the new one over a short animation window,
// re-snapping to the route every frame so the glide follows the curve of the
// track rather than cutting the corner.
//
// It also resolves which way each vehicle is actually facing. The route
// polyline itself has no inherent direction (see routeMatch.ts) — a given
// segment's tangent could be read as pointing either way — so something else
// has to say which of the two is correct. No single real-time signal is
// reliable enough on its own to always be that arbiter:
//  - The feed's reported bearing is a placeholder (0) whenever the vehicle is
//    at rest, and can also report a plausible-looking but wrong value while
//    the vehicle is genuinely moving (e.g. a compass reading briefly thrown
//    off), so it can't be trusted unconditionally.
//  - The direction implied by how far the raw GPS position has moved since
//    the last poll is unusable below a minimum distance — a parked vehicle's
//    fix can jitter tens of metres between polls on GPS noise alone — and
//    even above that distance, a single fix can itself be a spatial outlier
//    that doesn't reflect where the vehicle really is.
//
// resolveTarget layers several signals, each a fallback for when the one
// before it isn't trustworthy:
//
//  1. Once there's a previous fix to measure real movement and continuity
//     from: whichever of {feed bearing, displacement-implied bearing} better
//     matches the vehicle's own established heading (continuity) is used —
//     an isolated glitch in one shows up as a poor match to the trend, while
//     the other keeps tracking it correctly. This also handles a real sharp
//     turn correctly (the route's terminus turnback loops curve through a
//     wide range of headings): right at such a turn, the segment's two
//     candidate directions end up nearly equidistant from the vehicle's
//     prior heading, so comparing continuity against the route segment alone
//     could pick the wrong one — but the feed's bearing and the displacement
//     both correctly show the turn already underway.
//
//     That still isn't quite enough on its own: the raw GPS fix itself can
//     occasionally be a corrupted or duplicated sample — a real regression
//     backward along the route, not just jitter — and when that happens, the
//     feed's onboard-computed bearing is typically corrupted right along
//     with it (since it's derived from that same bad position history), so
//     both signals can end up agreeing with each other on the wrong
//     direction. What tells a corrupted fix apart from a genuine reversal is
//     context: a corrupted fix breaks an *already-established* trend,
//     whereas a genuine reversal is always the very first moving poll after
//     a dwell, with no established trend yet to break. So a large break from
//     continuity is accepted immediately if there's no established trend yet
//     to contradict, or if an identical-looking break already showed up on
//     the immediately preceding poll (confirmed by recurring, not a
//     one-off) — otherwise it's held for exactly one poll, position
//     included, since it's the raw fix itself that's suspect, giving the
//     next poll (compared against this same still-good anchor) the chance to
//     either confirm it as real or reveal it as the blip it was. The same
//     scrutiny applies to a large jump while the vehicle is reportedly
//     stopped, since a corrupted fix isn't only a moving-speed problem.
//
//  2. Failing that (stopped, or not enough confirmed movement to trust a
//     fresh reading), continuity with the vehicle's own last displayed
//     heading. This keeps it stable while dwelling.
//
//  3. Failing that (first sighting, nothing to anchor to yet), the trip's
//     scheduled direction (see tripDirection.ts) — static schedule data,
//     unaffected by GPS or curve noise.

export interface AnimatedVehicle {
  vehicle: VehiclePosition;
  lat: number;
  lon: number;
  bearing: number;
}

const ANIM_MS = 1200;
// Displacement since the last fix (raw GPS, not snapped) below this is
// treated as GPS scatter / not-yet-real movement (see priority 1 above); a
// moving streetcar covers far more than this in a 15s poll interval.
const MIN_MOVE_M = 20;
// A parked vehicle reports speed 0 but its raw GPS fix can still jitter
// 20-50m between polls, clearing MIN_MOVE_M on noise alone — require a
// nonzero reported speed too before trusting any displacement as real.
const STOPPED_MPS = 0.5;
// A break from continuity larger than this, with no feed bearing available
// to corroborate it, is treated as unconfirmed for one poll (see
// resolveTarget) rather than committed to immediately.
const UNCONFIRMED_TURN_DEG = 100;
// A break from continuity larger than this is a "big swing" — never seen on
// a legitimate continuing curve (the sharpest real one observed is ~99°), but
// typical of both a genuine terminus reversal and a corrupted GPS fix (see
// resolveTarget for how those two are told apart).
const BIG_SWING_DEG = 120;
// How many consecutive confirmed-moving polls establish the current
// direction as a "trend" a big swing must contend with, rather than a fresh
// departure free to swing hard. Only the very first poll after a dwell gets
// the free pass (streak 0) — a corrupted fix can show up as soon as the very
// next one, with only a single confirmed poll behind the trend so far.
const CONFIRM_STREAK = 1;
// A displacement beyond ordinary GPS jitter (~20-50m) while the feed reports
// the vehicle at rest. A corrupted fix isn't only a moving-speed problem —
// the raw position can jump well past plausible jitter while the vehicle
// reports itself fully stopped.
const JITTER_CEILING_M = 75;

interface Pose {
  lat: number;
  lon: number;
  bearing: number;
}

// The continuity/displacement anchor carried between polls: the resolved pose
// plus the raw (unsnapped) fix it was resolved from, so the next poll can
// measure real movement rather than trusting a momentary speed reading.
// Exported (with resolveTarget below) so replayHeadings.ts can replay the
// exact shipped logic against recorded history instead of a hand-copied
// duplicate that could silently drift out of sync.
export interface Anchor extends Pose {
  rawLat: number;
  rawLon: number;
  // Consecutive confirmed-moving polls that agreed with the current bearing —
  // resets to 0 on any dwell. See BIG_SWING_DEG/CONFIRM_STREAK above.
  streak: number;
  // The raw fix that got rejected as an unconfirmed big swing, if the
  // immediately preceding poll was one. If the next poll swings the same way
  // again, that's normally accepted rather than held indefinitely — except
  // the upstream feed can itself resend an identical stale fix for an extra
  // poll cycle (same feed_timestamp, different row), which would otherwise
  // "confirm itself". So that only counts as confirmation when the new fix
  // is actually a different position, not a repeat of this one.
  rejected: { rawLat: number; rawLon: number } | undefined;
}

function snapped(v: VehiclePosition): { lat: number; lon: number; segBearing: number } {
  const s = snapToRoute(v.latitude, v.longitude);
  return s
    ? { lat: s.lat, lon: s.lon, segBearing: s.segmentBearing }
    : { lat: v.latitude, lon: v.longitude, segBearing: v.bearing ?? 0 };
}

// Signed smallest rotation from `from` to `to`, in degrees (−180..180].
function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function resolveTarget(v: VehiclePosition, prev: Anchor | undefined): Anchor {
  const { lat, lon, segBearing } = snapped(v);
  const rawLat = v.latitude;
  const rawLon = v.longitude;

  if (prev) {
    const moved = metersBetween(prev.rawLat, prev.rawLon, rawLat, rawLon);
    // Require both a real reported speed and real displacement: a genuinely
    // parked vehicle reports speed 0 even while its raw GPS fix jitters
    // 20-50m between polls (see snapped()'s callers), so displacement alone
    // isn't enough to rule out noise.
    if ((v.speed_mps ?? 0) > STOPPED_MPS && moved >= MIN_MOVE_M) {
      const travel = headingBetween(prev.rawLat, prev.rawLon, rawLat, rawLon);
      // Both the feed's bearing and the raw-position-derived travel bearing
      // are independent, individually-noisy readings — either can glitch on
      // a single poll (a compass thrown off, or a one-off bad GPS fix), and
      // whichever one glitches, the other is usually still good. Continuity
      // with the established trend is what tells them apart: prefer
      // whichever is closer to it.
      // A poll we already rejected only counts as "confirmed by recurring" if
      // this poll is a genuinely different fix — not the upstream feed
      // resending the same stale one for an extra cycle.
      const isStaleRepeat =
        prev.rejected != null && metersBetween(prev.rejected.rawLat, prev.rejected.rawLon, rawLat, rawLon) < MIN_MOVE_M;
      const alreadyRejected = prev.rejected != null && !isStaleRepeat;

      let reference = travel;
      let unconfirmed = false;
      if (v.bearing != null && v.bearing !== 0) {
        const feedDiff = Math.abs(shortestAngleDelta(prev.bearing, v.bearing));
        const travelDiff = Math.abs(shortestAngleDelta(prev.bearing, travel));
        reference = feedDiff <= travelDiff ? v.bearing : travel;
      } else if (!alreadyRejected && Math.abs(shortestAngleDelta(prev.bearing, travel)) > UNCONFIRMED_TURN_DEG) {
        // No feed bearing to corroborate a sharp break from the established
        // trend with (it read as the placeholder 0 despite genuine movement).
        // Could be a real turn just starting, or a lone noisy fix — unless we
        // already held for this exact reason last poll, in which case accept
        // it now rather than potentially holding forever.
        unconfirmed = true;
      }
      const candidateBearing = alignToTrack(segBearing, reference);
      const bigSwing = Math.abs(shortestAngleDelta(prev.bearing, candidateBearing)) > BIG_SWING_DEG;

      if (isStaleRepeat || unconfirmed || (bigSwing && prev.streak >= CONFIRM_STREAK && !alreadyRejected)) {
        // Hold — not just the bearing but the position too, since it's the
        // raw fix itself that's suspect. Remember what got rejected so the
        // next poll, if it's a genuinely different fix that agrees, gets
        // accepted rather than held again.
        return { ...prev, rejected: { rawLat, rawLon } };
      }
      return {
        lat,
        lon,
        rawLat,
        rawLon,
        bearing: candidateBearing,
        streak: bigSwing ? 1 : prev.streak + 1,
        rejected: undefined,
      };
    }
    // Not moving (or not moving enough to trust a fresh direction
    // resolution). Ordinary GPS jitter here (~20-50m) is normal and we just
    // follow it — but a bigger jump needs the same scrutiny a moving-branch
    // fix gets: is it a backward break from the established trend (a
    // corrupted fix), or a real relocation (approaching a stop after a fast
    // segment can itself cover 100+m, in the same direction as the trend)?
    if (moved > JITTER_CEILING_M) {
      const travel = headingBetween(prev.rawLat, prev.rawLon, rawLat, rawLon);
      const isStaleRepeat =
        prev.rejected != null && metersBetween(prev.rejected.rawLat, prev.rejected.rawLon, rawLat, rawLon) < MIN_MOVE_M;
      const bigSwing = Math.abs(shortestAngleDelta(prev.bearing, travel)) > BIG_SWING_DEG;
      if (bigSwing && (prev.rejected == null || isStaleRepeat)) {
        return { ...prev, rejected: { rawLat, rawLon } };
      }
    }
    return { ...prev, lat, lon, rawLat, rawLon, streak: 0, rejected: undefined };
  }

  const dirRef = directionReferenceBearing(v.direction_id);
  const bearing = dirRef != null ? alignToTrack(segBearing, dirRef) : segBearing;
  return { lat, lon, rawLat, rawLon, bearing, streak: 0, rejected: undefined };
}

const prefersReducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useAnimatedVehicles(vehicles: VehiclePosition[]): AnimatedVehicle[] {
  const posesRef = useRef<Map<string, Pose>>(new Map()); // current on-screen pose (mutated per frame)
  const prevTargetsRef = useRef<Map<string, Anchor>>(new Map()); // last poll's settled target, the heading continuity anchor
  const rafRef = useRef<number | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const poses = posesRef.current;
    const prevTargets = prevTargetsRef.current;
    const starts = new Map<string, Pose>();
    const targets = new Map<string, Anchor>();

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
