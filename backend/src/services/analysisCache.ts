// Tiny in-memory TTL cache for analysis responses.
//
// The heatmap query scans the whole history and is the most expensive thing this
// service does, while its inputs are coarse (a date range, a time-of-day window)
// and repeat constantly as the page re-renders. Caching mirrors the approach
// already used for predictions: plain module state, no Redis, correct because the
// backend runs pinned to a single replica (minReplicas = maxReplicas = 1, so that
// two pollers don't duplicate rows).

interface Entry {
  expiresAt: number;
  payload: unknown;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 32;

const cache = new Map<string, Entry>();

export function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.payload as T;
}

export function setCached(key: string, payload: unknown, ttlMs: number = TTL_MS): void {
  // Evict the oldest insertion when full. Map preserves insertion order, so the
  // first key is the oldest - good enough for a cache this small.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, payload });
}

export const CACHE_TTL_SECONDS = TTL_MS / 1000;
