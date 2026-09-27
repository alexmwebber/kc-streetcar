// Tiny in-memory TTL cache for analysis responses.
//
// This is not just a latency optimisation. Neon scales the compute to zero after
// ~5 minutes of inactivity, and every query wakes it and holds it awake for that
// timer - so a cache miss costs ~5 minutes of billed compute, not ~3 seconds of
// query. Serving from memory is what keeps the analysis page from pinning the
// database awake all day.
//
// Plain module state, no Redis: the backend runs pinned to a single replica
// (minReplicas = maxReplicas = 1, so two pollers can't duplicate rows), which is
// also what makes a process-local cache correct here.

interface Entry {
  expiresAt: number;
  payload: unknown;
}

// Six hours, matching the request grid in analysisService: within one bucket the
// key is stable, so the first request computes and the rest are free. Multi-week
// averages do not meaningfully move inside six hours.
const TTL_MS = 6 * 60 * 60 * 1000;

// The UI offers only presets - 4 date ranges x 5 time-of-day x 3 directions x 3 bin
// sizes = 180 combinations - and payloads are ~40-95 KB. 64 entries is a few MB and
// holds every combination anyone actually revisits.
const MAX_ENTRIES = 64;

const cache = new Map<string, Entry>();

export function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  // Re-insert to move this key to the end, making eviction least-recently-USED
  // rather than least-recently-written. Without it a burst of one-off filter
  // combinations would evict the default view that most visitors land on.
  cache.delete(key);
  cache.set(key, entry);
  return entry.payload as T;
}

export function setCached(key: string, payload: unknown, ttlMs: number = TTL_MS): void {
  cache.delete(key);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, payload });
}

export const CACHE_TTL_SECONDS = TTL_MS / 1000;
