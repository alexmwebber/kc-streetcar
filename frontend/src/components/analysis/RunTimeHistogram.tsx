import { useMemo, useState } from "react";
import { SERIES_COLORS } from "../../lib/seriesColors.js";
import { DIRECTION_LABELS } from "../../lib/tripDirection.js";
import type { Theme } from "../../lib/useTheme.js";
import type { RunTimes } from "../../types/analysis.js";

// How long a full terminal-to-terminal run takes, as a histogram of whole minutes
// with one bar per direction in each minute. Hand-rolled SVG for the same reasons
// as SpeedProfileChart, and in the same idiom.
//
// GROUPED bars rather than overlaid: the two directions' distributions overlap
// almost entirely, and translucent overlapping bars would mix the two hues into a
// third colour that means nothing.

const WIDTH = 1000;
const HEIGHT = 240;
const PAD = { top: 26, right: 16, bottom: 34, left: 46 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

/** Surface gap between neighbouring bars, and around each minute's group. */
const BAR_GAP = 2;
const GROUP_GAP = 6;
const CORNER = 4;
/** Minimum horizontal spacing between x-axis labels, in viewBox units. */
const MIN_LABEL_GAP = 36;

interface RunTimeHistogramProps {
  runTimes: RunTimes;
  theme: Theme;
}

/** ~4 round ticks from 0 to at least `max`. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
  const ticks: number[] = [];
  for (let t = 0; t < max + step; t += step) ticks.push(t);
  return ticks;
}

/** A bar anchored to the baseline with only its data end rounded. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(CORNER, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function formatMinutes(s: number): string {
  return `${(s / 60).toFixed(1)} min`;
}

export default function RunTimeHistogram({ runTimes, theme }: RunTimeHistogramProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { directions, minMinute } = runTimes;

  const buckets = directions[0]?.counts.length ?? 0;
  const maxCount = Math.max(0, ...directions.flatMap((d) => d.counts));
  const yTicks = useMemo(() => niceTicks(maxCount), [maxCount]);
  const yMax = yTicks[yTicks.length - 1];

  const bandW = buckets > 0 ? PLOT_W / buckets : PLOT_W;
  const barW = Math.max(1, (bandW - GROUP_GAP - BAR_GAP * (directions.length - 1)) / Math.max(1, directions.length));
  const y = (v: number) => PAD.top + PLOT_H - (v / yMax) * PLOT_H;

  // Label every Nth minute edge so labels never crowd, however wide the range.
  const labelEvery = [1, 2, 5, 10, 15, 30].find((n) => n * bandW >= MIN_LABEL_GAP) ?? 30;
  const edges = Array.from({ length: buckets + 1 }, (_, i) => minMinute + i).filter((m) => m % labelEvery === 0);

  const total = directions.reduce((sum, d) => sum + d.n, 0);

  return (
    <figure className="chart-figure runtime-figure">
      <figcaption className="chart-title">
        End-to-end run time
        <span className="chart-subtitle">
          terminal to terminal, layover excluded &middot; {total.toLocaleString()} complete runs
        </span>
      </figcaption>

      {total === 0 ? (
        <p className="analysis-sub">No complete runs in this window.</p>
      ) : (
        <>
          <div className="chart-legend">
            {directions.map(({ direction }) => (
              <span key={direction} className="legend-item">
                <span
                  className="legend-swatch"
                  style={{ background: SERIES_COLORS[theme][direction] }}
                  aria-hidden="true"
                />
                {DIRECTION_LABELS[direction]}
              </span>
            ))}
          </div>

          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="chart-svg"
            role="img"
            aria-label="Histogram of end-to-end run times in minutes, one bar per direction"
            onPointerLeave={() => setHovered(null)}
          >
            {yTicks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(tick)} y2={y(tick)} className="chart-grid" />
                <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="chart-tick">
                  {tick}
                </text>
              </g>
            ))}
            <text x={6} y={PAD.top - 12} className="chart-axis-label">
              runs
            </text>

            {edges.map((m) => {
              const ex = PAD.left + (m - minMinute) * bandW;
              return (
                <text key={m} x={ex} y={PAD.top + PLOT_H + 16} textAnchor="middle" className="chart-tick">
                  {m}
                </text>
              );
            })}
            <text x={PAD.left + PLOT_W} y={HEIGHT - 2} textAnchor="end" className="chart-axis-label">
              minutes
            </text>

            {hovered !== null && (
              <rect
                x={PAD.left + hovered * bandW}
                y={PAD.top}
                width={bandW}
                height={PLOT_H}
                className="runtime-hover-band"
              />
            )}

            {Array.from({ length: buckets }, (_, i) => (
              <g key={i}>
                {directions.map(({ direction, counts }, j) => {
                  const count = counts[i];
                  if (count === 0) return null;
                  const bx = PAD.left + i * bandW + GROUP_GAP / 2 + j * (barW + BAR_GAP);
                  const by = y(count);
                  return (
                    <path
                      key={direction}
                      d={barPath(bx, by, barW, PAD.top + PLOT_H - by)}
                      fill={SERIES_COLORS[theme][direction]}
                    />
                  );
                })}
                {/* Hit target: the whole minute band, full height, so short bars
                    are as easy to hover as tall ones. */}
                <rect
                  x={PAD.left + i * bandW}
                  y={PAD.top}
                  width={bandW}
                  height={PLOT_H}
                  fill="transparent"
                  onPointerEnter={() => setHovered(i)}
                />
              </g>
            ))}

            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={PAD.top + PLOT_H}
              y2={PAD.top + PLOT_H}
              className="chart-baseline"
            />
          </svg>

          <div className="chart-readout" aria-live="polite">
            {hovered === null ? (
              directions.map((d) => (
                <span key={d.direction} className="readout-item">
                  <span
                    className="legend-swatch"
                    style={{ background: SERIES_COLORS[theme][d.direction] }}
                    aria-hidden="true"
                  />
                  {DIRECTION_LABELS[d.direction]}: median <strong>{formatMinutes(d.medianS)}</strong>
                  <span className="tooltip-muted">
                    middle 80% {formatMinutes(d.p10S)}&ndash;{formatMinutes(d.p90S)} &middot; n={d.n}
                  </span>
                </span>
              ))
            ) : (
              <>
                <strong>
                  {minMinute + hovered}&ndash;{minMinute + hovered + 1} min
                </strong>
                {directions.map((d) => (
                  <span key={d.direction} className="readout-item">
                    <span
                      className="legend-swatch"
                      style={{ background: SERIES_COLORS[theme][d.direction] }}
                      aria-hidden="true"
                    />
                    {DIRECTION_LABELS[d.direction]}: <strong>{d.counts[hovered]}</strong>
                    <span className="tooltip-muted">
                      {d.counts[hovered] === 1 ? "run" : "runs"} ({((d.counts[hovered] / d.n) * 100).toFixed(0)}%)
                    </span>
                  </span>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </figure>
  );
}
