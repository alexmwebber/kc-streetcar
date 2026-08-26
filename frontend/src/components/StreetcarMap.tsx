import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";
import { fetchLivePositions } from "../api/vehicles.js";
import type { VehiclePosition } from "../types/vehicle.js";
import { bearingToCompass, createVehicleIcon } from "./VehicleMarker.js";
import streetcarRoute from "../data/streetcarRoute.json";

const POLL_INTERVAL_MS = 15000;
const ROUTE_COLOR = "#0693E3";
// Two paths: the KC Streetcar runs a one-way loop near River Market (northbound via
// Grand Ave, southbound via Delaware St) before sharing a single track the rest of the
// way to UMKC. Both are rendered; they coincide everywhere except that northern loop.
const ROUTE_PATHS = streetcarRoute.paths as [number, number][][];
const ROUTE_STOPS = streetcarRoute.stops as { name: string; lat: number; lon: number }[];
const ALL_ROUTE_POINTS = ROUTE_PATHS.flat();
const ROUTE_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...ALL_ROUTE_POINTS.map((p) => p[0])), Math.min(...ALL_ROUTE_POINTS.map((p) => p[1]))],
  [Math.max(...ALL_ROUTE_POINTS.map((p) => p[0])), Math.max(...ALL_ROUTE_POINTS.map((p) => p[1]))],
];

export default function StreetcarMap() {
  const [vehicles, setVehicles] = useState<VehiclePosition[]>([]);

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
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
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

      {vehicles.map((v) => (
        <Marker key={v.vehicle_id} position={[v.latitude, v.longitude]} icon={createVehicleIcon(v.bearing ?? 0)}>
          <Popup>
            <div>
              <strong>{v.vehicle_label ?? v.vehicle_id}</strong>
              <br />
              Speed: {v.speed_mps != null ? `${v.speed_mps.toFixed(1)} m/s` : "n/a"}
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
