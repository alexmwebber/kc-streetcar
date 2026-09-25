import { METRICS, NO_DATA_COLOR, rampFor, type Metric } from "../../lib/metrics.js";
import type { Theme } from "../../lib/useTheme.js";

interface SpeedLegendProps {
  theme: Theme;
  binMeters: number;
  metric: Metric;
}

export default function SpeedLegend({ theme, binMeters, metric }: SpeedLegendProps) {
  const def = METRICS[metric];
  const ramp = rampFor(metric, theme);

  return (
    <div className="legend">
      <div className="legend-row">
        <span className="legend-caption">Average {def.label.toLowerCase()}</span>
        {ramp.map((color, i) => (
          <span key={color} className="legend-item">
            <span className="legend-swatch" style={{ background: color }} aria-hidden="true" />
            {def.classLabels[i]}
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: NO_DATA_COLOR, opacity: 0.55 }} aria-hidden="true" />
          too few samples
        </span>
      </div>
      {/* The exclusions are real analytical choices, not implementation details -
          say them on the page rather than burying them in a commit message. */}
      <p className="legend-note">
        Averaged over {binMeters} m stretches. {def.note}
      </p>
    </div>
  );
}
