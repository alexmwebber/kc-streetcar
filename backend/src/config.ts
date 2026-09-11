import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  swiftlyApiKey: required("SWIFTLY_API_KEY"),
  gtfsRtUrl: required("GTFS_RT_URL"),
  streetcarRouteId: required("STREETCAR_ROUTE_ID"),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 15000),
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 3001),
  // "*" locally so the Vite dev server (any port) can call the API freely.
  // Set to the deployed frontend's origin in production.
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};
