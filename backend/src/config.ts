import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const gtfsRtBaseUrl = required("GTFS_RT_BASE_URL");

export const config = {
  swiftlyApiKey: required("SWIFTLY_API_KEY"),
  gtfsRtVehiclePositionsUrl: `${gtfsRtBaseUrl}/gtfs-rt-vehicle-positions`,
  gtfsRtTripUpdatesUrl: `${gtfsRtBaseUrl}/gtfs-rt-trip-updates`,
  streetcarRouteId: required("STREETCAR_ROUTE_ID"),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 15000),
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 3001),
  // "*" locally so the Vite dev server (any port) can call the API freely.
  // In production, CORS_ORIGIN holds the deployed frontend's origin(s) -
  // comma-separated if there's more than one (e.g. a custom domain plus the
  // platform's default hostname).
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
};

function parseCorsOrigin(value: string | undefined): string | string[] {
  if (!value) return "*";
  const origins = value.split(",").map((origin) => origin.trim());
  return origins.length === 1 ? origins[0] : origins;
}
