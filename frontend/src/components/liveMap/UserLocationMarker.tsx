import { CircleMarker } from "react-leaflet";
import type { UserLocation } from "../../lib/useGeolocation.js";

const DOT_COLOR = "#4285F4";

export default function UserLocationMarker({ location }: { location: UserLocation }) {
  return (
    <CircleMarker
      center={[location.lat, location.lon]}
      radius={7}
      pathOptions={{ color: "#ffffff", weight: 2, fillColor: DOT_COLOR, fillOpacity: 1 }}
      interactive={false}
    />
  );
}
