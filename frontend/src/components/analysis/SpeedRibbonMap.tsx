import type { Map as LeafletMap } from "leaflet";
import { Fragment, useEffect, useMemo, useRef } from "react";
import { MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { METRICS, casingColor, metricColor, type Metric } from "../../lib/metrics.js";
import type { Theme } from "../../lib/useTheme.js";
import type { SpeedBin, SpeedProfile } from "../../types/analysis.js";

// This map is deliberately its own component with its own MapContainer, basemap and
// interactions - it shares only the route's real-world geometry with the live
// tracker, and that arrives from the API. The two are separate features and either
// can change without touching the other.

const CANVAS = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const TILES = {
  light: {
    base: `${CANVAS}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    ref: `${CANVAS}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  },
  dark: {
    base: `${CANVAS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    ref: `${CANVAS}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  },
};

const ATTRIBUTION = "Tiles &copy; Esri";

interface SpeedRibbonMapProps {
  profile: SpeedProfile;
  theme: Theme;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
  /** Whether the map is currently blown up to fill the viewport. Only used to
   *  re-measure - the sizing itself is CSS on the wrapper. */
  expanded: boolean;
  metric: Metric;
}

/** Key for a physical stretch of track, ignoring direction. */
export function stretchKey(bin: Pick<SpeedBin, "path" | "bin">): string {
  return `${bin.path}|${bin.bin}`;
}

/** A merged stretch keeps the shape of a bin so metric definitions, which read
 *  `meanMps` / `meanOccupancy` off a bin, work on it unchanged. */
type Stretch = SpeedBin & { key: string; directions: number[] };

/**
 * Collapse the per-direction bins onto one ribbon per physical stretch.
 *
 * Both directions run over the same rails, so drawing them as separate polylines
 * stacks them exactly - whichever paints last wins and the map silently shows one
 * direction's colour while claiming to show both. Merging by sample-weighted mean
 * gives each stretch a single honest value. When the filter selects one direction
 * there is only one bin per stretch and this is a no-op; the chart always keeps the
 * directions apart, which is where the comparison belongs.
 */
function toStretches(bins: SpeedBin[]): Stretch[] {
  // Every averaged field is accumulated sample-weighted, so merging two directions
  // gives the same answer as if the query had not split them.
  const WEIGHTED = ["meanMps", "medianMps", "stoppedShare", "meanOccupancy", "medianOccupancy"] as const;

  const merged = new Map<string, { stretch: Stretch; sums: Record<string, number> }>();

  for (const bin of bins) {
    const key = stretchKey(bin);
    const existing = merged.get(key);
    if (existing) {
      for (const field of WEIGHTED) existing.sums[field] += bin[field] * bin.n;
      existing.stretch.n += bin.n;
      existing.stretch.directions.push(bin.direction);
    } else {
      const sums: Record<string, number> = {};
      for (const field of WEIGHTED) sums[field] = bin[field] * bin.n;
      merged.set(key, { stretch: { ...bin, key, directions: [bin.direction] }, sums });
    }
  }

  return [...merged.values()].map(({ stretch, sums }) => {
    const out = { ...stretch };
    for (const field of WEIGHTED) out[field] = sums[field] / stretch.n;
    return out;
  });
}

function nearestStop(profile: SpeedProfile, distM: number): string {
  let best = profile.stops[0];
  for (const stop of profile.stops) {
    if (Math.abs(stop.distM - distM) < Math.abs(best.distM - distM)) best = stop;
  }
  return best.name;
}

export default function SpeedRibbonMap({ profile, theme, hoveredKey, onHover, expanded, metric }: SpeedRibbonMapProps) {
  const mapRef = useRef<LeafletMap | null>(null);

  const bounds: [[number, number], [number, number]] = [
    [39.0335, -94.5905],
    [39.1185, -94.5695],
  ];

  // Same flex-layout measurement problem the live map has: height resolves after
  // layout, so Leaflet can come up zero-sized on first paint.
  //
  // Expanding re-runs this deliberately. The container goes from a ~380x760 column
  // to the full viewport, which Leaflet can't detect on its own - without
  // invalidateSize it keeps painting at the old size and the tiles tear. The
  // refit matters too: the route is ~10:1 tall, so the aspect change is drastic
  // enough that the old zoom would leave it clipped or marooned.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const map = mapRef.current;
      if (!map) return;
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [20, 20] });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const stretches = useMemo(() => toStretches(profile.bins), [profile]);

  return (
    <MapContainer
      ref={mapRef}
      bounds={bounds}
      boundsOptions={{ padding: [20, 20] }}
      // Leaflet snaps fitBounds to whole zoom levels by default, always rounding
      // DOWN, so a route that wants zoom 11.7 gets 11 and fills barely half the
      // frame. This line is tall and narrow and the container aspect changes a lot
      // between the column and the expanded view, so that rounding is the
      // difference between a legible ribbon and a thread. zoomSnap 0 lets the fit
      // be exact.
      zoomSnap={0}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer key={`base-${theme}`} url={TILES[theme].base} maxNativeZoom={16} maxZoom={19} attribution={ATTRIBUTION} />
      <TileLayer key={`ref-${theme}`} url={TILES[theme].ref} maxNativeZoom={16} maxZoom={19} />

      {stretches.map((stretch) => {
        const isHovered = hoveredKey === stretch.key;
        const def = METRICS[metric];
        const color = metricColor(metric, def.value(stretch), theme);
        const bothWays = stretch.directions.length > 1;

        return (
          <Fragment key={stretch.key}>
            {/* lineCap "butt" on all three: Leaflet defaults to round, which adds
                half the stroke width past each end. A 100 m bin is shorter than the
                7 px stroke at this zoom, so round caps turn the ribbon into a row of
                blobs instead of a continuous band. */}
            {/* Casing: a contrast line beneath the data line, so every step of the
                ramp stays legible over the basemap without drawing a border on the
                mark itself. Non-interactive so it never steals the hover. */}
            <Polyline
              positions={stretch.coords}
              interactive={false}
              pathOptions={{ color: casingColor(theme), weight: isHovered ? 15 : 11, opacity: 0.9, lineCap: "butt" }}
            />
            <Polyline
              positions={stretch.coords}
              interactive={false}
              pathOptions={{ color, weight: isHovered ? 11 : 7, opacity: 1, lineCap: "butt" }}
            />
            {/* Leaflet's hit area is exactly the stroke width, and a 7px ribbon is a
                pinpoint to aim at. This invisible fat line carries the hover and the
                tooltip so the target clears ~24px without thickening the mark. */}
            <Polyline
              positions={stretch.coords}
              pathOptions={{ color, weight: 24, opacity: 0, lineCap: "butt" }}
              eventHandlers={{
                mouseover: () => onHover(stretch.key),
                mouseout: () => onHover(null),
              }}
            >
              <Tooltip sticky className="ribbon-tooltip">
                {/* Value leads, label follows - the reader already has the place
                    and wants the number. */}
                <strong>{def.format(def.value(stretch))}</strong>
                <br />
                {(stretch.chainageM / 1000).toFixed(2)} km &middot; near {nearestStop(profile, stretch.chainageM)}
                <br />
                <span className="tooltip-muted">
                  {bothWays ? "both directions" : stretch.directions[0] === 1 ? "toward UMKC" : "toward Riverfront"}{" "}
                  &middot; n={stretch.n} &middot;{" "}
                  {/* The other measure rides along as context, so switching isn't
                      the only way to see it. */}
                  {metric === "speed"
                    ? `${Math.round(stretch.meanOccupancy)}% full`
                    : `${METRICS.speed.format(METRICS.speed.value(stretch))}`}
                </span>
              </Tooltip>
            </Polyline>
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
