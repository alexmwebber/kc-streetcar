import L from "leaflet";

const ROUTE_COLOR = "#0693E3"; // KC Streetcar brand color (routes.txt route_color)

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function bearingToCompass(bearing: number): string {
  const index = Math.round(bearing / 45) % 8;
  return COMPASS_POINTS[index];
}

export function createVehicleIcon(bearing: number): L.DivIcon {
  const html = `
    <svg width="34" height="34" viewBox="0 0 24 24" style="transform: rotate(${bearing}deg); transform-origin: center;">
      <path d="M12 1 L18 9 L6 9 Z" fill="${ROUTE_COLOR}" stroke="white" stroke-width="1.2" stroke-linejoin="round" />
      <rect x="7" y="8" width="10" height="14" rx="3" fill="${ROUTE_COLOR}" stroke="white" stroke-width="1.2" />
      <rect x="9" y="11" width="6" height="3.5" rx="1" fill="white" opacity="0.9" />
      <rect x="9" y="16" width="6" height="3.5" rx="1" fill="white" opacity="0.9" />
    </svg>
  `;

  return L.divIcon({
    html,
    className: "streetcar-icon",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}
