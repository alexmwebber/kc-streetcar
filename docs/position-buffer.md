# Position buffer and flushing

How vehicle positions from the Swiftly GTFS-realtime feed get from the poller into the `vehicle_positions` table.

## Why buffer at all

Writing every poll (every 15s) keeps the Neon Postgres compute awake around the clock. Batching writes into one insert every 30 minutes lets Neon scale to zero after 5 minutes idle between flushes, and replaces ~52,000 inserts/day with ~48.

## Flow

```
Swiftly feed ──(every 15s)──> addPositions() ──> in-memory buffer ──(every 30 min)──> flushPositions() ──> Postgres
                                                       │
                                                       └──> GET /api/vehicles/live
```

Two independent timers run in [poller.ts](../backend/src/services/poller.ts):

| Timer | Interval | Config | Touches DB? |
|---|---|---|---|
| Poll | 15s | `POLL_INTERVAL_MS` | No |
| Flush | 30 min | `FLUSH_INTERVAL_MS` | Yes, one bulk insert |

## The buffer

[positionBuffer.ts](../backend/src/services/positionBuffer.ts) holds three structures:

- **`pending`**: rows waiting to be written, in arrival order.
- **`latestByVehicle`**: newest position per vehicle. Survives flushes and is what `/api/vehicles/live` serves, so the live map never reads the database.
- **`seen`**: `vehicleId|feedTimestamp` keys. The feed occasionally resends an identical stale fix (~0.27% of rows); these are dropped here so duplicates never reach the table.

Housekeeping:

- Vehicles not heard from in 5 minutes are dropped from `latestByVehicle` (and the live map).
- `seen` is cleared once it exceeds 20,000 keys.
- `pending` is capped at 20,000 rows (normal is ~1,100 per window). If flushes keep failing, the oldest rows are dropped rather than letting the container run out of memory.

## Flushing

`flushPositions()` in [poller.ts](../backend/src/services/poller.ts):

1. Returns immediately if a flush is already running or nothing is pending.
2. Takes the whole `pending` array and empties the buffer.
3. Writes it with a single `INSERT ... SELECT * FROM unnest(...)` ([vehicleRepository.ts](../backend/src/services/vehicleRepository.ts)). Route chainage is computed per row at this point. Using `unnest` keeps the SQL text constant regardless of batch size, so there is no parameter-limit risk on a large catch-up flush.
4. **On success:** runs `warmAnalysisIfDue()` to refresh the analysis cache while the database is already awake.
5. **On failure:** puts the batch back at the front of `pending`. The next scheduled flush retries it, so a transient DB error costs latency, not data.

## Shutdown

[index.ts](../backend/src/index.ts) handles `SIGTERM`/`SIGINT`: it stops accepting requests, runs a final flush, then exits. Azure Container Apps sends `SIGTERM` before replacing a revision, so deploys and normal restarts lose nothing.

## Trade-offs and constraints

- **A hard crash loses up to one flush interval** (≤30 min) of unflushed positions. This is acceptable for a historical-analysis dataset.
- **The backend must run exactly one replica** (`minReplicas = maxReplicas = 1`). Multiple replicas would each hold a partial buffer, `/live` would flip between them, and positions would be written twice.
- **The database lags real time by up to 30 minutes.** Anything that needs current positions must read from the buffer, not from Postgres.
