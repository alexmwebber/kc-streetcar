import { METRICS, type Metric } from "../../lib/metrics.js";
import { DIRECTION_LABELS, TOWARD_RIVERFRONT, TOWARD_UMKC } from "../../lib/tripDirection.js";

// One row, above everything it scopes. Standard HTML controls styled to match the
// existing chrome tokens - these are UI, not chart marks.

export interface FilterState {
  days: number | null; // null = all available history
  todFrom: string | null;
  todTo: string | null;
  direction: number | null;
  binMeters: number;
}

const DAY_PRESETS: { label: string; days: number | null }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All", days: null },
];

// Presets before a custom range - nobody reaches for a time picker to say
// "afternoon". Local (America/Chicago) throughout, matching the API.
const TOD_PRESETS: { label: string; from: string | null; to: string | null }[] = [
  { label: "All day", from: null, to: null },
  { label: "AM peak", from: "07:00", to: "09:00" },
  { label: "Midday", from: "11:00", to: "14:00" },
  { label: "PM peak", from: "16:00", to: "18:00" },
  { label: "Evening", from: "18:00", to: "23:00" },
];

const BIN_SIZES = [50, 100, 200];

interface SpeedFiltersProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  disabled?: boolean;
  metric: Metric;
  onMetricChange: (metric: Metric) => void;
}

export default function SpeedFilters({ value, onChange, disabled, metric, onMetricChange }: SpeedFiltersProps) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="filter-bar">
      {/* Measure comes first: it changes what every view below is showing, so it
          belongs at the head of the row that scopes them. It is not a filter -
          both measures come back in the same response over the same rows, so
          switching repaints without refetching. */}
      <fieldset className="filter-group">
        <legend className="filter-label">Measure</legend>
        <div className="segmented">
          {(Object.keys(METRICS) as Metric[]).map((key) => (
            <button
              key={key}
              type="button"
              className={metric === key ? "seg seg-active" : "seg"}
              aria-pressed={metric === key}
              onClick={() => onMetricChange(key)}
            >
              {METRICS[key].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="filter-group" disabled={disabled}>
        <legend className="filter-label">Date range</legend>
        <div className="segmented">
          {DAY_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={value.days === preset.days ? "seg seg-active" : "seg"}
              aria-pressed={value.days === preset.days}
              onClick={() => set({ days: preset.days })}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="filter-group" disabled={disabled}>
        <legend className="filter-label">Time of day</legend>
        <div className="segmented">
          {TOD_PRESETS.map((preset) => {
            const active = value.todFrom === preset.from && value.todTo === preset.to;
            return (
              <button
                key={preset.label}
                type="button"
                className={active ? "seg seg-active" : "seg"}
                aria-pressed={active}
                onClick={() => set({ todFrom: preset.from, todTo: preset.to })}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="filter-group" disabled={disabled}>
        <legend className="filter-label">Direction</legend>
        <div className="segmented">
          <button
            type="button"
            className={value.direction === null ? "seg seg-active" : "seg"}
            aria-pressed={value.direction === null}
            onClick={() => set({ direction: null })}
          >
            Both
          </button>
          {[TOWARD_UMKC, TOWARD_RIVERFRONT].map((dir) => (
            <button
              key={dir}
              type="button"
              className={value.direction === dir ? "seg seg-active" : "seg"}
              aria-pressed={value.direction === dir}
              onClick={() => set({ direction: dir })}
            >
              {DIRECTION_LABELS[dir].replace("Toward ", "")}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="filter-group" disabled={disabled}>
        <legend className="filter-label">Detail</legend>
        <div className="segmented">
          {BIN_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={value.binMeters === size ? "seg seg-active" : "seg"}
              aria-pressed={value.binMeters === size}
              onClick={() => set({ binMeters: size })}
            >
              {size} m
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
