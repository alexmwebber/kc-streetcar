-- Linear referencing against the known route alignment (src/data/streetcarRoute.json),
-- so the speed heatmap is a plain GROUP BY instead of re-projecting every row per
-- request. Written by insertPosition() on every new row; historical rows are filled
-- by dev-tools/backfillDistAlongRoute.ts.
--
-- IMPORTANT: db/migrate.ts has no ledger - it re-runs every .sql file in this
-- directory on every `npm run migrate`. Everything here must stay idempotent, and
-- nothing expensive or one-shot (backfills, DELETEs) belongs in this file.
--
-- Column notes:
--   dist_along_route_m  metres from the north (Riverfront) end of the matched path.
--                       Stored even for far-off-route fixes (garage moves, GPS
--                       spikes) - route_offset_m is what queries filter on, so the
--                       off-route threshold stays tunable in SQL rather than baked
--                       into the data.
--   route_offset_m      perpendicular distance from the line. Doubles as the
--                       backfill's "not yet processed" marker, so all three columns
--                       are always written together.
--   route_path_idx      which of the two polylines matched. The one-way River Market
--                       loop legs diverge by up to ~178 m, so the heatmap draws each
--                       bin on the alignment the vehicle was actually on instead of
--                       rescaling one onto the other.
--
-- REAL not DOUBLE PRECISION: ~0.001 m resolution at 10 km, matches the existing
-- speed_mps/bearing convention, and halves the covering index's payload.
-- Adding nullable columns with no default is metadata-only in PG11+, so this is
-- instant and safe to run while the poller is writing.
ALTER TABLE vehicle_positions ADD COLUMN IF NOT EXISTS dist_along_route_m REAL;
ALTER TABLE vehicle_positions ADD COLUMN IF NOT EXISTS route_offset_m     REAL;
ALTER TABLE vehicle_positions ADD COLUMN IF NOT EXISTS route_path_idx     SMALLINT;

-- The heatmap aggregation is a feed_timestamp range scan that reads exactly these
-- columns, so INCLUDE makes it an index-only scan and skips the heap entirely.
-- id is in the list because the dedup step orders by it to break ties
-- deterministically; leaving it out silently costs the index-only scan.
-- (Only effective once VACUUM has set the visibility map - see the backfill script.)
--
-- Deliberately not CONCURRENTLY: migrate.ts sends this whole file as one
-- multi-statement pool.query, which is an implicit transaction, and CONCURRENTLY
-- cannot run inside one. A plain build takes a SHARE lock that blocks writes for
-- roughly 1-3 s on 300k rows - one poll cycle at worst.
CREATE INDEX IF NOT EXISTS idx_vehicle_positions_speed_analysis
    ON vehicle_positions (feed_timestamp)
    INCLUDE (id, vehicle_id, direction_id, speed_mps, occupancy_percentage,
             dist_along_route_m, route_offset_m, route_path_idx);
