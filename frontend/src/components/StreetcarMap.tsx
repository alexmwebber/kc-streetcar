import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";
import { fetchLivePositions } from "../api/vehicles.js";
import type { VehiclePosition } from "../types/vehicle.js";
import { bearingToCompass, createVehicleIcon } from "./VehicleMarker.js";
import { nearestPointOnRoute } from "../lib/routeMatch.js";
import { useAnimatedVehicles } from "../lib/useAnimatedVehicles.js";
import streetcarRoute from "../data/streetcarRoute.json";

const POLL_INTERVAL_MS = 15000;
const ROUTE_COLOR = "#0693E3";
// Two paths: the KC Streetcar runs a one-way loop near River Market (northbound via
// Grand Ave, southbound via Delaware St) before sharing a single track the rest of the
// way to UMKC. Both are rendered; they coincide everywhere except that northern loop.
const ROUTE_PATHS = streetcarRoute.paths as [number, number][][];
const ROUTE_STOPS = (streetcarRoute.stops as { name: string; lat: number; lon: number }[]).map((stop) => {
  const [lat, lon] = nearestPointOnRoute(stop.lat, stop.lon);
  return { name: stop.name, lat, lon };
});
const ALL_ROUTE_POINTS = ROUTE_PATHS.flat();
const ROUTE_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...ALL_ROUTE_POINTS.map((p) => p[0])), Math.min(...ALL_ROUTE_POINTS.map((p) => p[1]))],
  [Math.max(...ALL_ROUTE_POINTS.map((p) => p[0])), Math.max(...ALL_ROUTE_POINTS.map((p) => p[1]))],
];

export default function StreetcarMap() {
  const [vehicles, setVehicles] = useState<VehiclePosition[]>([]);
  const animatedVehicles = useAnimatedVehicles(vehicles);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const positions = await fetchLivePositions();
        if (!cancelled) setVehicles(positions);
      } catch (err) {
        console.error("Failed to fetch live positions:", err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <MapContainer
      bounds={ROUTE_BOUNDS}
      boundsOptions={{ padding: [24, 24] }}
      style={{ height: "100vh", width: "100%" }}
    >
      {/* Esri Light Gray Canvas: muted backdrop (base) + street/place labels (reference).
          Esri only caches tiles to z16, so maxNativeZoom caps real tile requests there
          while maxZoom lets the map keep zooming (Leaflet upscales the z16 tiles). */}
      <TileLayer
        attribution='Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={16}
        maxZoom={19}
      />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={16}
        maxZoom={19}
      />

      {ROUTE_PATHS.map((path, i) => (
        <Polyline key={i} positions={path} pathOptions={{ color: ROUTE_COLOR, weight: 4, opacity: 0.6 }} />
      ))}

      {ROUTE_STOPS.map((stop) => (
        <CircleMarker
          key={stop.name}
          center={[stop.lat, stop.lon]}
          radius={4}
          pathOptions={{ color: ROUTE_COLOR, weight: 2, fillColor: "#ffffff", fillOpacity: 1 }}
        >
          <Tooltip direction="top" offset={[0, -4]}>
            {stop.name}
          </Tooltip>
        </CircleMarker>
      ))}

      {animatedVehicles.map(({ vehicle: v, lat, lon, bearing }) => (
        <Marker key={v.vehicle_id} position={[lat, lon]} icon={createVehicleIcon(bearing)}>
          <Popup>
            <div>
              <strong>{v.vehicle_label ?? v.vehicle_id}</strong>
              <br />
              Speed: {v.speed_mps != null ? `${(v.speed_mps * 2.236936).toFixed(1)} mph` : "n/a"}
              <br />
              Heading: {v.bearing != null ? `${bearingToCompass(v.bearing)} (${Math.round(v.bearing)}°)` : "n/a"}
              <br />
              Occupancy: {v.occupancy_percentage != null ? `${v.occupancy_percentage}%` : "n/a"}
              <br />
              Updated: {new Date(v.feed_timestamp).toLocaleTimeString()}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
