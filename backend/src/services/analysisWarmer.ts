import { cacheKeyFor, defaultProfileRequest, getProfilePayload, normalizeRequest } from "./analysisService.js";
import { getCached } from "./analysisCache.js";

// Keeps the analysis page's default view in memory so the common case never
// queries the database.
//
// This runs after a flush (see poller.ts)

async function warm(reason: string): Promise<void> {
  const started = Date.now();
  try {
    await getProfilePayload(defaultProfileRequest());
    console.log(`[warmer] default view ready (${reason}) in ${Date.now() - started}ms`);
  } catch (err) {
    // Non-fatal: the next visitor pays for the query instead.
    console.error(`[warmer] failed to warm default view (${reason}):`, err);
  }
}

/** Refresh the default view only if it isn't already cached - the request window
 *  snaps to a 6-hour grid, so most flushes find it still valid and do nothing. */
export async function warmAnalysisIfDue(): Promise<void> {
  const key = cacheKeyFor(normalizeRequest(defaultProfileRequest()));
  if (getCached(key)) return;
  await warm("after flush");
}

/** One warm at startup so the first visitor after a deploy isn't the one who pays
 *  to rebuild the cache. Delayed so it doesn't compete with the first poll. */
export function startAnalysisWarmer(): void {
  setTimeout(() => void warm("startup"), 30_000);
}
