import { config } from "../config.js";
import { fetchStreetcarPositions } from "./gtfsClient.js";
import { fetchStreetcarPredictions } from "./predictionsClient.js";
import { warmAnalysisIfDue } from "./analysisWarmer.js";
import { addPositions, pendingCount, restorePending, takePending } from "./positionBuffer.js";
import { setPredictions } from "./predictionsStore.js";
import { insertPositions } from "./vehicleRepository.js";

// Two independent rhythms:
//
//   - Poll the feed every ~15s into memory. No database contact at all.
//   - Flush (bulk insert) the buffer to Postgres every ~30 minutes.
let flushing = false;

/**
 * Write whatever is buffered. Safe to call concurrently with itself (it no-ops)
 * and safe to call when there's nothing pending.
 *
 * On failure the rows go back on the queue and the next flush retries them, so a
 * transient database error costs latency rather than data.
 */
export async function flushPositions(reason: string): Promise<void> {
  if (flushing) return;
  const batch = takePending();
  if (batch.length === 0) return;

  flushing = true;
  const started = Date.now();
  try {
    await insertPositions(batch);
    console.log(`[flush] wrote ${batch.length} position(s) in ${Date.now() - started}ms (${reason})`);

    // The compute is awake right now for this write, so refreshing the analysis
    // cache here is free. Doing it on its own timer would risk waking a sleeping
    // database purely to recompute an average.
    await warmAnalysisIfDue();
  } catch (err) {
    restorePending(batch);
    console.error(`[flush] failed (${reason}), ${pendingCount()} row(s) requeued:`, err);
  } finally {
    flushing = false;
  }
}

export function startPoller(): void {
  const poll = async () => {
    try {
      const positions = await fetchStreetcarPositions();
      const added = addPositions(positions);
      // `added` can be lower than the fetch count when the feed resends a fix we
      // already hold - those are dropped here rather than in every later query.
      console.log(`[poller] buffered ${added}/${positions.length} position(s), ${pendingCount()} pending`);
    } catch (err) {
      console.error("[poller] failed to fetch positions:", err);
    }

    try {
      const predictions = await fetchStreetcarPredictions();
      setPredictions(predictions);
    } catch (err) {
      console.error("[poller] failed to fetch predictions:", err);
    }
  };

  poll();
  setInterval(poll, config.pollIntervalMs);
  setInterval(() => void flushPositions("scheduled"), config.flushIntervalMs);

  console.log(
    `[poller] polling every ${config.pollIntervalMs / 1000}s, ` +
      `flushing every ${config.flushIntervalMs / 60000}min`,
  );
}
