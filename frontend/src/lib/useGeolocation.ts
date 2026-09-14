import { useEffect, useRef, useState } from "react";

export interface UserLocation {
  lat: number;
  lon: number;
  accuracy: number;
  heading: number | null;
}

/** Watches the browser's geolocation for as long as the map is mounted. */
export function useGeolocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
        });
      },
      () => setLocation(null),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );

    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, []);

  return location;
}
