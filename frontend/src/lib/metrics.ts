import type { SpeedBin } from "../types/analysis.js";
import type { Theme } from "./useTheme.js";

// Everything that differs between the two heatmaps lives here: the value read off
// a bin, the class breaks, the colour ramps, the axis, the wording. The ribbon,
// chart, legend, stat tiles and table all read from these definitions, so adding a
// third measure later is one entry rather than a hunt through five components.
//
// Both measures come back in the same API response over the same rows, so
// switching is instant and the two are genuinely comparable.

export type Metric = "speed" | "occupancy";

export const MPS_TO_MPH = 2.23694;

export function toMph(mps: number): number {
  return mps * MPS_TO_MPH;
}

export interface MetricDef {
  key: Metric;
  /** Control label. */
  label: string;
  /** Chart title. */
  title: string;
  /** Page heading. */
  pageTitle: string;
  /** Reads the displayed value off a bin, already in display units. */
  value: (bin: SpeedBin) => number;
  format: (value: number) => string;
  /** Upper bound of the profile chart's y-axis. */
  axisMax: number;
  axisTicks: number[];
  axisLabel: string;
  /** Ascending class breaks, in display units. */
  breaks: number[];
  classLabels: string[];
  /** Wording for the two extreme-value stat tiles. */
  lowLabel: string;
  highLabel: string;
  /** One line under the legend explaining what the numbers mean. */
  note: string;
}

// Both ramps for both measures were checked with the dataviz validator in
// --ordinal mode against the surfaces they actually sit on (#eef1f3 light,
// #16181c dark): monotone lightness, every adjacent gap >= 0.06 L, and the light
// end clearing the surface at >= 2:1. Ordinal is the right mode for a map, where
// EVERY class has to stay visible against the basemap.
//
// Each array runs from class 0 (lowest) to class 4 (highest).
//
// The two measures deliberately use different hues. They share a page and a
// toggle, so if both were blue you could not tell at a glance which one you were
// looking at.
//
// They also orient their ramps differently in dark mode, on purpose:
//
//   - SPEED is anchor-flipped. It encodes SLOWNESS as weight, so the interesting
//     extreme is the low end; on a dark surface the near-black step recedes, so
//     the slowest class takes the brightest step instead of the darkest.
//   - OCCUPANCY keeps light = empty, dark = full in BOTH themes. "Fuller is
//     darker" is the intuitive reading of a load profile and it should not invert
//     when the theme changes. The cost is that the fullest class is the step
//     closest to the dark surface, so its contrast is the one to watch - #7a3a0c
//     clears it at 2.06:1, which is what keeps the busiest stretches from sinking
//     into the basemap.
const RAMPS: Record<Metric, Record<Theme, string[]>> = {
  // Blue. Encodes SLOWNESS as weight - heaviest ink where the streetcar bogs
  // down, which is the thing the page exists to show.
  speed: {
    light: ["#0d366b", "#184f95", "#256abf", "#3987e5", "#6da7ec"],
    dark: ["#cde2fb", "#9ec5f4", "#5598e7", "#2a78d6", "#184f95"],
  },
  // Amber, light -> dark as the vehicle fills, in both themes.
  occupancy: {
    light: ["#e79049", "#d4761f", "#ad5813", "#84420f", "#582a08"],
    dark: ["#f5cfa8", "#e8a46a", "#d1721c", "#a85513", "#7a3a0c"],
  },
};

export const METRICS: Record<Metric, MetricDef> = {
  speed: {
    key: "speed",
    label: "Speed",
    title: "Average speed along the route",
    pageTitle: "Where the streetcar runs fast and slow",
    value: (bin) => toMph(bin.meanMps),
    format: (v) => `${v.toFixed(1)} mph`,
    axisMax: 32,
    axisTicks: [0, 8, 16, 24, 32],
    axisLabel: "mph",
    // Fixed, not derived from the data, so a colour means the same speed in every
    // query and changing a filter never repaints the bins that survive it.
    // Spans the observed 0.6-30.5 mph.
    breaks: [6, 12, 18, 24],
    classLabels: ["under 6 mph", "6-12 mph", "12-18 mph", "18-24 mph", "24+ mph"],
    lowLabel: "Slowest stretch",
    highLabel: "Fastest stretch",
    note:
      "Stops at terminals lasting over two minutes are excluded as layover; ordinary stop dwell and red lights are included.",
  },
  occupancy: {
    key: "occupancy",
    label: "Occupancy",
    title: "Average occupancy along the route",
    pageTitle: "Where the streetcar is full and empty",
    value: (bin) => bin.meanOccupancy,
    format: (v) => `${v.toFixed(0)}%`,
    axisMax: 100,
    axisTicks: [0, 25, 50, 75, 100],
    axisLabel: "% full",
    // Also fixed. Bin averages run ~7-70% all-day but reach 95% at PM peak, so
    // round 20-point steps stay readable and still exercise the whole scale. The
    // top class is open-ended, which also absorbs the readings over 100%.
    breaks: [20, 40, 60, 80],
    classLabels: ["under 20%", "20-40%", "40-60%", "60-80%", "80%+"],
    lowLabel: "Emptiest stretch",
    highLabel: "Fullest stretch",
    note:
      "Percentage of seats occupied, so it can exceed 100% when riders are standing. Terminal layovers are excluded, so this is the load while in service.",
  },
};

/** Bins below the sample threshold. Deliberately desaturated so "no data" can
 *  never be mistaken for a value. */
export const NO_DATA_COLOR = "#898781";

export function metricClass(metric: Metric, value: number): number {
  const { breaks } = METRICS[metric];
  for (let i = 0; i < breaks.length; i++) {
    if (value < breaks[i]) return i;
  }
  return breaks.length;
}

export function metricColor(metric: Metric, value: number, theme: Theme): string {
  return RAMPS[metric][theme][metricClass(metric, value)];
}

export function rampFor(metric: Metric, theme: Theme): string[] {
  return RAMPS[metric][theme];
}

/** Casing drawn under each ribbon segment - a contrast line rather than a stroke
 *  around the mark, so every step stays legible over the basemap. */
export function casingColor(theme: Theme): string {
  return theme === "dark" ? "#16181c" : "#ffffff";
}
