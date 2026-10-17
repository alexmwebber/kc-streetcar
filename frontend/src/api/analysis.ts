import type { Coverage, RunTimeQuery, RunTimes, SpeedProfile, SpeedProfileQuery } from "../types/analysis.js";

// Empty in local dev: requests stay relative and Vite proxies /api to the backend
// (see vite.config.ts). In production builds this is set to the deployed API origin
// at build time.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export async function fetchSpeedProfile(query: SpeedProfileQuery, signal?: AbortSignal): Promise<SpeedProfile> {
  const params = new URLSearchParams({
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    bin: String(query.binMeters),
  });
  if (query.direction !== null) params.set("direction", String(query.direction));
  // The API rejects a lone bound, so only send the pair.
  if (query.todFrom && query.todTo) {
    params.set("todFrom", query.todFrom);
    params.set("todTo", query.todTo);
  }

  const res = await fetch(`${API_BASE_URL}/api/analysis/speed-by-distance?${params}`, { signal });
  if (!res.ok) {
    // The API returns {error} with a reason on a 400 - surface it rather than a
    // bare status code, since these are usually fixable from the filter bar.
    const detail = await res
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new Error(detail ?? `Failed to fetch speed profile: ${res.status}`);
  }
  return res.json();
}

export async function fetchCoverage(signal?: AbortSignal): Promise<Coverage> {
  const res = await fetch(`${API_BASE_URL}/api/analysis/coverage`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch coverage: ${res.status}`);
  }
  return res.json();
}

export async function fetchRunTimes(query: RunTimeQuery, signal?: AbortSignal): Promise<RunTimes> {
  const params = new URLSearchParams({ from: query.from.toISOString(), to: query.to.toISOString() });
  if (query.direction !== null) params.set("direction", String(query.direction));
  if (query.todFrom && query.todTo) {
    params.set("todFrom", query.todFrom);
    params.set("todTo", query.todTo);
  }

  const res = await fetch(`${API_BASE_URL}/api/analysis/run-times?${params}`, { signal });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new Error(detail ?? `Failed to fetch run times: ${res.status}`);
  }
  return res.json();
}
