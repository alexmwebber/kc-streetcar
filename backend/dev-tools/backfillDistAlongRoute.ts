// Fills dist_along_route_m / route_offset_m / route_path_idx on rows written before
// migration 002. New rows get them at insert time (see vehicleRepository.ts), so this
// only ever has to catch up history.
//
// Run:  npx tsx dev-tools/backfillDistAlongRoute.ts
// Reads DATABASE_URL the same way the app does (backend/.env via config.ts).
//
// Safe to interrupt and re-run: `route_offset_m IS NULL` is the progress marker and
// `id > lastId` guarantees forward motion, so a crash just resumes. Safe to run while
// the poller is writing - it only touches rows the poller has already inserted.
//
// Each batch is ONE autocommit statement: no cursors, no long transactions, no session
// state, which is what makes it safe through Neon's PgBouncer transaction pooling.
//
// AFTERWARDS, run:  VACUUM (ANALYZE) vehicle_positions;
// over the DIRECT (non-pooled) connection - VACUUM cannot run inside a transaction
// block. Without it this leaves ~1 dead tuple per row updated, and the covering index
// from migration 002 can't do index-only scans until the visibility map is set.

import { pool } from "../src/db/pool.js";
import { locateOnRoute } from "../src/lib/routeGeometry.js";

const BATCH = 5000;
const PAUSE_MS = 50; // be polite to Neon and to the live poller

async function main() {
  const { rows: before } = await pool.query<{ pending: string }>(
    "SELECT count(*)::text AS pending FROM vehicle_positions WHERE route_offset_m IS NULL",
  );
  const pending = Number(before[0].pending);

  if (pending === 0) {
    console.log("[backfill] nothing to do - every row already has chainage.");
    return;
  }
  console.log(`[backfill] ${pending} row(s) to locate, ${BATCH} per batch`);

  const started = Date.now();
  let lastId = "0";
  let done = 0;

  for (;;) {
    const { rows } = await pool.query<{ id: string; latitude: number; longitude: number }>(
      `SELECT id, latitude, longitude
         FROM vehicle_positions
        WHERE id > $1 AND route_offset_m IS NULL
        ORDER BY id
        LIMIT $2`,
      [lastId, BATCH],
    );
    if (rows.length === 0) break;

    const ids: string[] = [];
    const dist: number[] = [];
    const offset: number[] = [];
    const pathIdx: number[] = [];

    for (const row of rows) {
      const located = locateOnRoute(row.latitude, row.longitude);
      ids.push(row.id);
      dist.push(located.distAlongM);
      offset.push(located.offsetM);
      pathIdx.push(located.pathIdx);
    }

    await pool.query(
      `UPDATE vehicle_positions v
          SET dist_along_route_m = u.dist,
              route_offset_m     = u.offset_m,
              route_path_idx     = u.path_idx
         FROM unnest($1::bigint[], $2::real[], $3::real[], $4::smallint[])
              AS u(id, dist, offset_m, path_idx)
        WHERE v.id = u.id`,
      [ids, dist, offset, pathIdx],
    );

    lastId = rows[rows.length - 1].id;
    done += rows.length;
    console.log(`[backfill] ${done}/${pending} (${((100 * done) / pending).toFixed(1)}%)  lastId=${lastId}`);

    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[backfill] done: ${done} row(s) in ${elapsed}s`);
  console.log("[backfill] now run:  VACUUM (ANALYZE) vehicle_positions;   (direct connection, not the pooler)");
}

main()
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
