import { defaultProfileRequest, getProfilePayload, WINDOW_BUCKET_MS } from "./analysisService.js";

// Computes the analysis page's default view on a schedule so the common case is
// always served from memory.
//
// The point is to control WHEN the database is woken rather than leaving it to
// visitor traffic. A cache miss costs ~5 minutes of billed Neon compute (its
// scale-to-zero idle timer), so a handful of visitors arriving at scattered times
// can keep the compute awake most of the day. One scheduled refresh per bucket
// costs one wake, no matter how many people visit.
//
// Once the poller buffers writes and flushes periodically, this should be moved to
// run right AFTER a flush: the compute is already awake for the flush, so the
// refresh becomes free rather than costing a wake of its own.

// Warm shortly after boot rather than immediately - let the server finish starting
// and the first poll happen before adding a multi-second query.
const INITIAL_DELAY_MS = 30_000;

async function warm(reason: string): Promise<void> {
  const started = Date.now();
  try {
    await getProfilePayload(defaultProfileRequest());
    console.log(`[warmer] default view ready (${reason}) in ${Date.now() - started}ms`);
  } catch (err) {
    // Non-fatal: a failed warm just means the next visitor pays for the query.
    console.error(`[warmer] failed to warm default view (${reason}):`, err);
  }
}

export function startAnalysisWarmer(): void {
  setTimeout(() => {
    void warm("startup");
    // Re-warm once per bucket, so the entry is refreshed about when its key rolls
    // over rather than expiring and waiting for a visitor to pay for it.
    setInterval(() => void warm("scheduled"), WINDOW_BUCKET_MS);
  }, INITIAL_DELAY_MS);
}
