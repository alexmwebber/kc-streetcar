import { useEffect, useMemo, useState } from "react";
import { fetchCoverage, fetchSpeedProfile } from "../api/analysis.js";
import SpeedFilters, { type FilterState } from "../components/analysis/SpeedFilters.js";
import SpeedLegend from "../components/analysis/SpeedLegend.js";
import SpeedProfileChart from "../components/analysis/SpeedProfileChart.js";
import SpeedRibbonMap, { stretchKey } from "../components/analysis/SpeedRibbonMap.js";
import SpeedTable from "../components/analysis/SpeedTable.js";
import { METRICS, type Metric } from "../lib/metrics.js";
import type { Theme } from "../lib/useTheme.js";
import type { Coverage, SpeedProfile } from "../types/analysis.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_FILTERS: FilterState = {
  days: 30,
  todFrom: null,
  todTo: null,
  direction: null,
  binMeters: 100,
};

interface SpeedAnalysisProps {
  theme: Theme;
}

export default function SpeedAnalysis({ theme }: SpeedAnalysisProps) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [profile, setProfile] = useState<SpeedProfile | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hoveredChainageM, setHoveredChainageM] = useState<number | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [metric, setMetric] = useState<Metric>("speed");

  // Escape closes the expanded map, which is what anything covering the viewport
  // should do. Bound only while expanded so it can't swallow Escape elsewhere.
  useEffect(() => {
    if (!mapExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMapExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mapExpanded]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCoverage(controller.signal)
      .then(setCoverage)
      .catch(() => {
        // Non-fatal: coverage only annotates the header.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    const to = new Date();
    // `days: null` means "all of it"; the API caps the span at 400 days.
    const from = filters.days === null ? new Date(to.getTime() - 399 * DAY_MS) : new Date(to.getTime() - filters.days * DAY_MS);

    fetchSpeedProfile(
      { from, to, binMeters: filters.binMeters, direction: filters.direction, todFrom: filters.todFrom, todTo: filters.todTo },
      controller.signal,
    )
      .then((next) => {
        setProfile(next);
        setError(null);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [filters]);

  // Hovering either view highlights the other. The map keys on an exact bin; the
  // chart only knows an x position, so map that back to whichever bins cover it.
  const hoveredFromChart = useMemo(() => {
    if (hoveredChainageM === null || !profile) return null;
    const half = profile.binMeters / 2;
    const hit = profile.bins.find((b) => Math.abs(b.chainageM - hoveredChainageM) <= half);
    return hit ? stretchKey(hit) : null;
  }, [hoveredChainageM, profile]);

  const activeMapKey = hoveredKey ?? hoveredFromChart;

  const activeChainage = useMemo(() => {
    if (hoveredChainageM !== null) return hoveredChainageM;
    if (!hoveredKey || !profile) return null;
    return profile.bins.find((b) => stretchKey(b) === hoveredKey)?.chainageM ?? null;
  }, [hoveredChainageM, hoveredKey, profile]);

  const stats = useMemo(() => {
    if (!profile || profile.bins.length === 0) return null;
    const def = METRICS[metric];
    // Sample-weighted, so this is the average over the whole line rather than an
    // average of per-bin averages (which would over-weight sparse bins).
    const totalN = profile.bins.reduce((sum, b) => sum + b.n, 0);
    const overall = profile.bins.reduce((sum, b) => sum + def.value(b) * b.n, 0) / totalN;
    const sorted = [...profile.bins].sort((a, b) => def.value(a) - def.value(b));
    return { overall, low: sorted[0], high: sorted[sorted.length - 1], totalN };
  }, [profile, metric]);

  const backfillPending = coverage !== null && coverage.locatedRowCount < coverage.rowCount;

  return (
    <div className="analysis-page">
      <header className="analysis-header">
        <h1 className="analysis-title">{METRICS[metric].pageTitle}</h1>
        <p className="analysis-sub">
          Measured from {coverage ? coverage.rowCount.toLocaleString() : "—"} stored
          position reports.
          {coverage?.firstSample && (
            <>
              {" "}
              Collected since {new Date(coverage.firstSample).toLocaleDateString()}.
            </>
          )}
        </p>
        {backfillPending && (
          <p className="analysis-warning">
            {(coverage.rowCount - coverage.locatedRowCount).toLocaleString()} rows have not been located onto the route
            yet, so this is based on partial history.
          </p>
        )}
      </header>

      <SpeedFilters
        value={filters}
        onChange={setFilters}
        disabled={loading && !profile}
        metric={metric}
        onMetricChange={setMetric}
      />

      {error && <p className="analysis-error">{error}</p>}

      {stats && (
        <div className="stat-row">
          <div className="stat-tile">
            <span className="stat-label">Overall average</span>
            <span className="stat-value">{METRICS[metric].format(stats.overall)}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">{METRICS[metric].lowLabel}</span>
            <span className="stat-value">{METRICS[metric].format(METRICS[metric].value(stats.low))}</span>
            <span className="stat-note">at {(stats.low.chainageM / 1000).toFixed(1)} km</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">{METRICS[metric].highLabel}</span>
            <span className="stat-value">{METRICS[metric].format(METRICS[metric].value(stats.high))}</span>
            <span className="stat-note">at {(stats.high.chainageM / 1000).toFixed(1)} km</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Samples</span>
            <span className="stat-value">{stats.totalN.toLocaleString()}</span>
            <span className="stat-note">after excluding layover</span>
          </div>
        </div>
      )}

      {/* Hold the previous render at reduced opacity while refetching - no skeleton,
          no layout jump. */}
      <div className="analysis-body" style={{ opacity: loading && profile ? 0.6 : 1 }}>
        {profile ? (
          <div className={mapExpanded ? "analysis-columns analysis-columns-expanded" : "analysis-columns"}>
            {/* The legend travels with the map into the expanded state - the ribbon
                encodes speed with colour alone, so it can never be on screen
                without its key. */}
            <div className={mapExpanded ? "map-column map-column-expanded" : "map-column"}>
              <div className="ribbon-wrap">
                <SpeedRibbonMap
                  profile={profile}
                  theme={theme}
                  hoveredKey={activeMapKey}
                  onHover={setHoveredKey}
                  expanded={mapExpanded}
                  metric={metric}
                />
                <button
                  type="button"
                  className="map-expand-btn"
                  aria-expanded={mapExpanded}
                  aria-label={mapExpanded ? "Shrink map" : "Expand map"}
                  onClick={() => setMapExpanded((v) => !v)}
                  title={mapExpanded ? "Shrink map (Esc)" : "Expand map"}
                >
                  {/* Corner brackets: pointing out to expand, in to shrink. */}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {mapExpanded ? (
                      <path d="M9 3v6H3M21 9h-6V3M15 21v-6h6M3 15h6v6" />
                    ) : (
                      <path d="M3 9V3h6M21 9V3h-6M15 21h6v-6M9 21H3v-6" />
                    )}
                  </svg>
                </button>
              </div>
              <SpeedLegend theme={theme} binMeters={profile.binMeters} metric={metric} />
            </div>
            <div className="chart-column">
              <SpeedProfileChart
                profile={profile}
                theme={theme}
                hoveredChainageM={activeChainage}
                onHoverChainage={setHoveredChainageM}
                metric={metric}
              />
              <SpeedTable profile={profile} />
            </div>
          </div>
        ) : (
          !error && <p className="analysis-sub">Loading speed history&hellip;</p>
        )}
      </div>
    </div>
  );
}
