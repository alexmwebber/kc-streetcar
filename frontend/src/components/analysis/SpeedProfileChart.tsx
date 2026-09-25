import { useMemo, useRef, useState } from "react";
import { METRICS, type Metric } from "../../lib/metrics.js";
import { DIRECTION_LABELS, TOWARD_RIVERFRONT, TOWARD_UMKC } from "../../lib/tripDirection.js";
import type { Theme } from "../../lib/useTheme.js";
import type { SpeedProfile } from "../../types/analysis.js";

// Hand-rolled SVG rather than a charting library: this is one step line with fixed
// domains and two series, which is ~200 lines here against 90-130 KB gzipped and a
// foreign event model for the shared hover with the map. PollProgress already draws
// its ring this way, so the idiom is not new to this codebase.
//
// A STEP line, not a smooth one: each bin is an interval average, and interpolating
// between bin midpoints would draw speeds that were never measured.

const WIDTH = 1000;
// Bottom padding carries the rotated stop names; the plot itself is HEIGHT - PAD.
const HEIGHT = 300;
const PAD = { top: 26, right: 16, bottom: 104, left: 46 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

// Two series, so they get the categorical slots 1 and 2 - distinct hues, not steps
// of the speed ramp (which encodes magnitude and would collide in meaning).
const SERIES_COLORS: Record<Theme, Record<number, string>> = {
  light: { [TOWARD_UMKC]: "#2a78d6", [TOWARD_RIVERFRONT]: "#eb6834" },
  dark: { [TOWARD_UMKC]: "#3987e5", [TOWARD_RIVERFRONT]: "#d95926" },
};

interface SpeedProfileChartProps {
  profile: SpeedProfile;
  theme: Theme;
  hoveredChainageM: number | null;
  onHoverChainage: (m: number | null) => void;
  metric: Metric;
}

interface Point {
  chainageM: number;
  value: number;
  n: number;
}

export default function SpeedProfileChart({
  profile,
  theme,
  hoveredChainageM,
  onHoverChainage,
  metric,
}: SpeedProfileChartProps) {
  const def = METRICS[metric];
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [pointerX, setPointerX] = useState<number | null>(null);

  const routeLength = profile.routeLengthM;
  const x = (m: number) => PAD.left + (m / routeLength) * PLOT_W;
  const y = (v: number) => PAD.top + PLOT_H - (Math.min(v, def.axisMax) / def.axisMax) * PLOT_H;

  // Bins carry a `path`, and around the River Market loop the same chainage can have
  // a bin on each alignment. The map draws those separately (they are different
  // streets); the chart has one x-axis, so merge them by sample-weighted mean.
  const series = useMemo(() => {
    const byDirection = new Map<number, Map<number, { sum: number; n: number }>>();
    for (const bin of profile.bins) {
      let byBin = byDirection.get(bin.direction);
      if (!byBin) byDirection.set(bin.direction, (byBin = new Map()));
      const acc = byBin.get(bin.bin) ?? { sum: 0, n: 0 };
      acc.sum += def.value(bin) * bin.n;
      acc.n += bin.n;
      byBin.set(bin.bin, acc);
    }
    return [...byDirection.entries()]
      .map(([direction, byBin]) => ({
        direction,
        points: [...byBin.entries()]
          .map(([bin, acc]): Point => ({
            chainageM: bin * profile.binMeters + profile.binMeters / 2,
            value: acc.sum / acc.n,
            n: acc.n,
          }))
          .sort((a, b) => a.chainageM - b.chainageM),
      }))
      .sort((a, b) => a.direction - b.direction);
  }, [profile, def]);

  // Which stops get a name. Rotated labels still need horizontal room, so walk the
  // stops in order and keep one only when it has cleared MIN_LABEL_GAP from the
  // last one kept. Dropping a label is safe: the stop keeps its rule either way.
  const stopLabels = useMemo(() => {
    // Rotated labels stack diagonally, so the binding constraint is the
    // PERPENDICULAR gap between baselines, not the horizontal one: a horizontal
    // separation d gives d*sin(45deg) of clearance. ~10 units of text needs ~12
    // units perpendicular, so d >= 17. 20 leaves a little slack. Units are viewBox
    // units, and the font is too, so this stays correct at any rendered width.
    const MIN_LABEL_GAP = 20;
    const kept: { name: string; shortName: string; distM: number }[] = [];
    let lastX = -Infinity;

    for (const stop of [...profile.stops].sort((a, b) => a.distM - b.distM)) {
      const sx = PAD.left + (stop.distM / profile.routeLengthM) * PLOT_W;
      if (sx - lastX < MIN_LABEL_GAP) continue;
      kept.push({
        ...stop,
        // "Union Station (Pershing & Main St)" -> "Union Station". The cross-street
        // is what makes these unambiguous on the map, and pure noise on an axis.
        shortName: stop.name.split(" (")[0],
      });
      lastX = sx;
    }
    return kept;
  }, [profile]);

  // Step path: hold each bin's value across its full width, then jump.
  const stepPath = (points: Point[]): string => {
    const half = profile.binMeters / 2;
    let d = "";
    for (const [i, p] of points.entries()) {
      const left = x(p.chainageM - half);
      const right = x(p.chainageM + half);
      const py = y(p.value);
      const prev = points[i - 1];
      // Only connect when bins are adjacent; a gap in coverage stays a gap rather
      // than being bridged by a line nobody measured.
      const contiguous = prev && Math.abs(p.chainageM - prev.chainageM - profile.binMeters) < 1;
      d += `${contiguous ? "L" : "M"}${left.toFixed(1)},${py.toFixed(1)}L${right.toFixed(1)},${py.toFixed(1)}`;
    }
    return d;
  };

  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
    if (px < PAD.left || px > PAD.left + PLOT_W) {
      setPointerX(null);
      onHoverChainage(null);
      return;
    }
    setPointerX(px);
    onHoverChainage(((px - PAD.left) / PLOT_W) * routeLength);
  };

  const clearHover = () => {
    setPointerX(null);
    onHoverChainage(null);
  };

  // Readout for the crosshair: every series at this x, so the pointer never has to
  // land on a line to get a value.
  const activeChainage = hoveredChainageM;
  const readout =
    activeChainage === null
      ? null
      : series.map(({ direction, points }) => {
          let best: Point | null = null;
          for (const p of points) {
            if (
              Math.abs(p.chainageM - activeChainage) <= profile.binMeters / 2 &&
              (!best || Math.abs(p.chainageM - activeChainage) < Math.abs(best.chainageM - activeChainage))
            ) {
              best = p;
            }
          }
          return { direction, point: best };
        });

  const crosshairX = pointerX ?? (activeChainage !== null ? x(activeChainage) : null);

  return (
    <figure className="chart-figure">
      <figcaption className="chart-title">
        {def.title}
        <span className="chart-subtitle">
          north (Riverfront) to south (UMKC) &middot; {profile.binMeters} m bins
        </span>
      </figcaption>

      <div className="chart-legend">
        {series.map(({ direction }) => (
          <span key={direction} className="legend-item">
            <span
              className="legend-line"
              style={{ background: SERIES_COLORS[theme][direction] }}
              aria-hidden="true"
            />
            {DIRECTION_LABELS[direction]}
          </span>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="chart-svg"
        role="img"
        aria-label="Average streetcar speed by distance along the route, one line per direction"
        onPointerMove={handleMove}
        onPointerLeave={clearHover}
      >
        {/* Recessive hairline grid - solid, one step off the surface, never dashed. */}
        {def.axisTicks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(tick)} y2={y(tick)} className="chart-grid" />
            <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="chart-tick">
              {tick}
            </text>
          </g>
        ))}
        <text x={6} y={PAD.top - 12} className="chart-axis-label">
          {def.axisLabel}
        </text>

        {/* A faint rule at every stop, running the height of the plot. This is the
            point of the chart: the troughs should line up with the stops, and
            without the rules you have to take that on trust. */}
        {profile.stops.map((stop) => (
          <line
            key={`rule-${stop.name}`}
            x1={x(stop.distM)}
            x2={x(stop.distM)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H + 4}
            className="chart-stopline"
          />
        ))}

        {/* Names are rotated because 20 stops across this width cannot sit flat,
            and dropped where they would collide with the last one drawn - the
            River Market pair is 51 m apart, about 5 px here. Every stop still gets
            its rule, so nothing is hidden; the crosshair readout names whichever
            one is nearest. */}
        {stopLabels.map((stop) => {
          const sx = x(stop.distM);
          const sy = PAD.top + PLOT_H + 12;
          return (
            <text
              key={`label-${stop.name}`}
              x={sx}
              y={sy}
              transform={`rotate(-45 ${sx} ${sy})`}
              textAnchor="end"
              className="chart-tick chart-stoplabel"
            >
              {stop.shortName}
            </text>
          );
        })}

        {crosshairX !== null && (
          <line
            x1={crosshairX}
            x2={crosshairX}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            className="chart-crosshair"
          />
        )}

        {series.map(({ direction, points }) => (
          <path
            key={direction}
            d={stepPath(points)}
            fill="none"
            stroke={SERIES_COLORS[theme][direction]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>

      <div className="chart-readout" aria-live="polite">
        {activeChainage === null ? (
          <span className="tooltip-muted">Hover the chart or the map to compare directions at a point.</span>
        ) : (
          <>
            <strong>{(activeChainage / 1000).toFixed(2)} km</strong>
            {readout?.map(({ direction, point }) => (
              <span key={direction} className="readout-item">
                <span
                  className="legend-line"
                  style={{ background: SERIES_COLORS[theme][direction] }}
                  aria-hidden="true"
                />
                {DIRECTION_LABELS[direction]}:{" "}
                {point ? (
                  <strong>
                    {def.format(point.value)} <span className="tooltip-muted">n={point.n}</span>
                  </strong>
                ) : (
                  <span className="tooltip-muted">no data</span>
                )}
              </span>
            ))}
          </>
        )}
      </div>
    </figure>
  );
}
