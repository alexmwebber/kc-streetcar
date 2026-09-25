import { useMemo, useState } from "react";
import { METRICS } from "../../lib/metrics.js";
import { DIRECTION_LABELS } from "../../lib/tripDirection.js";
import type { SpeedProfile } from "../../types/analysis.js";

// The map encodes speed with colour alone, so the values have to be reachable
// without hovering and without distinguishing hues. This is that twin: the same
// data as plain text, sortable, and the accessible fallback the ribbon leans on.

type SortKey = "chainage" | "speed" | "occupancy" | "samples";

interface SpeedTableProps {
  profile: SpeedProfile;
}

function nearestStop(profile: SpeedProfile, distM: number): string {
  let best = profile.stops[0];
  for (const stop of profile.stops) {
    if (Math.abs(stop.distM - distM) < Math.abs(best.distM - distM)) best = stop;
  }
  return best.name;
}

export default function SpeedTable({ profile }: SpeedTableProps) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>("chainage");

  const rows = useMemo(() => {
    const sorted = [...profile.bins];
    sorted.sort((a, b) => {
      if (sort === "speed") return a.meanMps - b.meanMps;
      if (sort === "occupancy") return b.meanOccupancy - a.meanOccupancy;
      if (sort === "samples") return b.n - a.n;
      return a.chainageM - b.chainageM || a.direction - b.direction;
    });
    return sorted;
  }, [profile, sort]);

  return (
    <section className="table-view">
      <button type="button" className="table-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide" : "Show"} data table ({profile.bins.length} stretches)
      </button>

      {open && (
        <>
          <div className="table-sort">
            <span className="filter-label">Sort by</span>
            <div className="segmented">
              {(
                [
                  ["chainage", "Position"],
                  ["speed", "Slowest first"],
                  ["occupancy", "Fullest first"],
                  ["samples", "Most samples"],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={sort === key ? "seg seg-active" : "seg"}
                  aria-pressed={sort === key}
                  onClick={() => setSort(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">
                Average streetcar speed per {profile.binMeters} metre stretch of route, by direction
              </caption>
              <thead>
                <tr>
                  <th scope="col">Position</th>
                  <th scope="col">Nearest stop</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Speed</th>
                  <th scope="col">Median</th>
                  <th scope="col">Occupancy</th>
                  <th scope="col">Stopped</th>
                  <th scope="col">Samples</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((bin) => (
                  <tr key={`${bin.path}|${bin.bin}|${bin.direction}`}>
                    <td className="num">{(bin.chainageM / 1000).toFixed(2)} km</td>
                    <td>{nearestStop(profile, bin.chainageM)}</td>
                    <td>{DIRECTION_LABELS[bin.direction]}</td>
                    <td className="num">{METRICS.speed.format(METRICS.speed.value(bin))}</td>
                    <td className="num">{METRICS.speed.format(METRICS.speed.value({ ...bin, meanMps: bin.medianMps }))}</td>
                    <td className="num">{METRICS.occupancy.format(bin.meanOccupancy)}</td>
                    <td className="num">{Math.round(bin.stoppedShare * 100)}%</td>
                    <td className="num">{bin.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
