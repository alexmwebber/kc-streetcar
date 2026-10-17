/** One stretch of route, with the speed statistics measured over it.
 *
 *  `coords` comes from the API rather than being derived here: the backend owns
 *  the route geometry for this feature, so the analysis page shares no map code
 *  with the live tracker and the two can diverge freely. */
export interface SpeedBin {
  /** Which of the two track alignments this stretch is on. They differ only
   *  around the one-way River Market loop. */
  path: number;
  bin: number;
  /** GTFS direction_id: 0 toward Riverfront, 1 toward UMKC. */
  direction: number;
  coords: [number, number][];
  /** Midpoint distance from the north end, on the canonical alignment. */
  chainageM: number;
  n: number;
  meanMps: number;
  medianMps: number;
  /** Fraction of samples where the vehicle was stationary. */
  stoppedShare: number;
  /** GTFS-RT occupancy: percentage of SEATS occupied, so it legitimately exceeds
   *  100 when riders are standing. */
  meanOccupancy: number;
  medianOccupancy: number;
}

export interface SpeedProfile {
  binMeters: number;
  routeLengthM: number;
  speedCapMps: number;
  minSamples: number;
  /** When the server computed this. Requests are snapped to a 6-hour grid so the
   *  figures are deliberately a little behind live. */
  computedAt: string;
  stops: { name: string; distM: number }[];
  filters: {
    from: string;
    to: string;
    todFrom: string | null;
    todTo: string | null;
    direction: number | null;
  };
  bins: SpeedBin[];
}

export interface Coverage {
  firstSample: string | null;
  lastSample: string | null;
  rowCount: number;
  /** Rows that have been located onto the route. Below rowCount means the
   *  backfill hasn't finished. */
  locatedRowCount: number;
}

export interface SpeedProfileQuery {
  from: Date;
  to: Date;
  binMeters: number;
  direction: number | null;
  todFrom: string | null;
  todTo: string | null;
}

/** Terminal-to-terminal run times for one direction, bucketed by whole minute. */
export interface RunTimeDirection {
  /** GTFS direction_id: 0 toward Riverfront, 1 toward UMKC. */
  direction: number;
  n: number;
  meanS: number;
  medianS: number;
  p10S: number;
  p90S: number;
  /** `counts[i]` is runs taking [minMinute + i, minMinute + i + 1) minutes. */
  counts: number[];
}

export interface RunTimes {
  computedAt: string;
  filters: SpeedProfile["filters"];
  /** Lower edge of the first bucket; shared by every direction so they align. */
  minMinute: number;
  directions: RunTimeDirection[];
}

export type RunTimeQuery = Omit<SpeedProfileQuery, "binMeters">;
