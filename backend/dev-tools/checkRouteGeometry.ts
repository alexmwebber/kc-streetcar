// Warns when backend/src/data/streetcarRoute.json and the frontend's copy drift
// apart. The two files describe one physical streetcar route, so divergence means
// the live map and the speed heatmap are drawing different lines.
//
// This is NOT load-bearing for correctness: the analysis API returns drawable
// coordinates, so the frontend derives no chainage of its own and a mismatch can't
// corrupt the heatmap. It would just be quietly confusing. Treat a failure as
// "re-copy the file", not as a blocker.
//
// Never runs inside Docker - it reaches outside the build context (./backend) by
// design. It's a developer check: `npm run check:geometry`.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const FILES = {
  backend: new URL("../src/data/streetcarRoute.json", import.meta.url),
  frontend: new URL("../../frontend/src/data/streetcarRoute.json", import.meta.url),
};

function sha256(url: URL): string {
  return createHash("sha256").update(readFileSync(url)).digest("hex");
}

try {
  const backend = sha256(FILES.backend);
  const frontend = sha256(FILES.frontend);

  if (backend === frontend) {
    console.log(`[check:geometry] OK - both copies match (${backend.slice(0, 12)})`);
    process.exit(0);
  }

  console.error("[check:geometry] MISMATCH - the two route copies have drifted apart:");
  console.error(`  backend/src/data/streetcarRoute.json   ${backend.slice(0, 12)}`);
  console.error(`  frontend/src/data/streetcarRoute.json  ${frontend.slice(0, 12)}`);
  console.error("");
  console.error("  Copy whichever is correct over the other, then re-run the backfill if the");
  console.error("  backend's geometry changed (stored chainage would be stale).");
  process.exit(1);
} catch (err) {
  console.error("[check:geometry] could not read both copies:", err instanceof Error ? err.message : err);
  process.exit(1);
}
