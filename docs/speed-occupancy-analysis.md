# Speed and occupancy analysis

How the `/analysis` page's speed and occupancy numbers are computed from stored vehicle positions.

## Pipeline

```
Swiftly feed ─> poller ─> buffer ─(flush)─> vehicle_positions ─> SQL aggregation ─> cache ─> GET /api/analysis/speed-by-distance ─> frontend merging
                                  (chainage computed here)        (per path/bin/direction)
```

## 1. Raw inputs

Each row in `vehicle_positions` is one GPS fix from the GTFS-realtime feed, polled every ~15 s ([gtfsClient.ts](../backend/src/services/gtfsClient.ts)). The analysis uses these fields as the feed reports them:

| Column | Source | Notes |
|---|---|---|
| `speed_mps` | `vehicle.position.speed` | Reported by the feed, **not** derived from consecutive positions. |
| `occupancy_percentage` | `vehicle.occupancyPercentage` | Percentage of **seats** occupied, so it can exceed 100 (observed max 150). |
| `direction_id` | `vehicle.trip.directionId` | 0 = toward Riverfront, 1 = toward UMKC. |
| `feed_timestamp` | `vehicle.timestamp` (or feed header) | Used for windowing and run detection. |

## 2. Route location (at write time)

When the buffer is flushed ([vehicleRepository.ts](../backend/src/services/vehicleRepository.ts)), each fix is projected onto the route by `locateOnRoute()` in [routeGeometry.ts](../backend/src/lib/routeGeometry.ts) and three extra columns are stored:

- **`dist_along_route_m`**: chainage, metres from the north (Riverfront) end of the matched polyline.
- **`route_offset_m`**: perpendicular distance from the line, i.e. how much to trust the match.
- **`route_path_idx`**: which of the two route polylines matched (whichever is nearer).

The two polylines are identical except around the one-way River Market loop, where they diverge by up to ~178 m. Outside the loop, ties always resolve to path 0, so bins aren't split between paths there. The path index doesn't indicate direction; direction always comes from `direction_id`.

Projection uses a local equirectangular approximation centred on KC (sub-metre error at city scale).

## 3. Aggregation query

All of the computation happens in one SQL query in [speedAnalysisRepository.ts](../backend/src/services/speedAnalysisRepository.ts). Speed and occupancy are aggregated from the **same rows**, so the two metrics share a population and the page can switch between them without refetching.

### Step 1: load and dedupe (`raw`)

- Selects fixes in `[from − 15 min, to + 15 min)` where `speed_mps` is not null. The padding gives run detection context at the window edges.
- Deduplicates on `(vehicle_id, feed_timestamp)`, which removes stale resends from the feed (~0.27% of rows).
- **No user filters are applied yet.** Run detection needs each vehicle's full, contiguous series. Filtering first would leave gaps that could merge two dwells into one run, or cut a layover short enough to slip past the exclusion.

### Step 2: detect stationary runs (`marked` → `runs` → `spans`)

Per vehicle, ordered by time, a new run starts when:

- it's the vehicle's first fix, or
- the gap since the previous fix is over **60 s** (so an overnight absence can't join two dwells), or
- the vehicle switches between stopped (`speed < 0.5 m/s`) and moving.

Each run's duration (`run_span`) is its last timestamp minus its first.

### Step 3: exclude layovers and apply filters (`kept`)

Rows are dropped if any of the following is true:

| Rule | Purpose |
|---|---|
| Stopped **and** the run is over **120 s** | Removes layovers. Normal stop dwell and red lights are kept. |
| Outside the requested `[from, to)` | Removes the 15 min of padding. |
| `dist_along_route_m` is null, or `route_offset_m > 120` | Removes off-route fixes (uses the same threshold as the live map's snapping). |
| `speed_mps > 20` (~45 mph) | Removes GPS artifacts. Measured p99.9 is 22 m/s and the observed maximum is 30.8 m/s, which a streetcar can't reach here. |
| `direction_id` is not 0 or 1, or doesn't match the direction filter | |
| Outside the time-of-day window | The comparison uses **America/Chicago** local time, and windows that cross midnight (e.g. 22:00–02:00) are supported. |

Each surviving row is assigned `bin = floor(dist_along_route_m / binMeters)`, where `binMeters` is 50, 100 or 200.

The layover rule applies to any stationary run over 2 minutes, **wherever it happens on the route**. This is deliberate. In normal service nearly all such runs are at the terminals. When service is cut short and the line turns back mid-route, the turnaround layovers are excluded without needing to know where the temporary terminal is. The cost is that a rare long mid-route hold (for example, a blocked track) is also excluded, so it won't show up as a slow stretch.

This was tested on 2026-10-15 against a version that only excluded long stops within 200 m of either end of the line:

- **Normal service (30 days to Oct 11):** the terminal-only rule kept 1.9% more fixes. It changed the colour class of 5 of ~200 bins, and no bin by more than 2.2 mph.
- **Oct 12–14, when the line turned back at Union Station:** the terminal-only rule counted ~500 turnaround layovers as delay. That dropped Union Station toward UMKC to 0.6 mph.

The duration-only rule was kept.

### Step 4: aggregate per `(path, bin, direction)`

| Output | SQL | Meaning |
|---|---|---|
| `n` | `count(*)` | Number of fixes. |
| `meanMps` | `avg(speed_mps)` | **The headline speed.** |
| `medianMps` | `percentile_cont(0.5)` | Shown in the table only (per direction, unmerged). |
| `stoppedShare` | `avg(speed < 0.5)` | Fraction of fixes where the vehicle was stopped. |
| `meanOccupancy` | `avg(occupancy_percentage)` | **The headline occupancy.** |
| `medianOccupancy` | `percentile_cont(0.5)` | Returned but not currently displayed. |

Bins with `n < minSamples` (default 20) are removed with `HAVING`.

**Why the mean and not the median:** fixes arrive at a fixed cadence, so a time-sampled mean of speed approximates distance ÷ time across the bin, which is the true average traversal speed. Slow stretches produce more samples, and that weighting is intended. A median would throw it away.

### Step 5: shape the response

[analysisService.ts](../backend/src/services/analysisService.ts) converts the numeric strings to numbers and adds the following to each bin:

- `coords`: the polyline for that stretch, cut from the matched path (`sliceByChainage`).
- `chainageM`: the midpoint of the bin.

The payload also includes the route length (path 1, the canonical x-axis), stop chainages, the speed cap, the applied filters and `computedAt`.

## 4. Request window and caching

- `from` and `to` are rounded **down to a 6-hour grid** before the query runs and before the cache key is built. Without this, every page load would produce a unique key. The cost is that results can be up to ~6 h stale, and `computedAt` tells the user how old they are.
- Results are held in an in-memory LRU cache ([analysisCache.ts](../backend/src/services/analysisCache.ts)) with a 6 h TTL and up to 64 entries. This is safe because the backend runs as a single replica.
- After each successful buffer flush, [analysisWarmer.ts](../backend/src/services/analysisWarmer.ts) pre-computes the default view (last 30 days, 100 m bins, both directions, all day, `minSamples` 20) if it isn't already cached. It also runs once 30 s after startup.
- The query runs with a 20 s `statement_timeout`, set via `SET LOCAL` inside a transaction so it works with Neon's PgBouncer pooling.
- Request limits: the range can be at most 400 days, `bin` must be 50, 100 or 200, and `minSamples` must be between 1 and 1000.

## 5. Frontend merging and display

The API keeps bins split by direction and path. The frontend combines them in two places:

- **Map ribbon** ([SpeedRibbonMap.tsx](../frontend/src/components/analysis/SpeedRibbonMap.tsx)): when both directions are shown, bins with the same `(path, bin)` are merged into one stretch using an **`n`-weighted mean** of each averaged field.
- **Profile chart** ([SpeedProfileChart.tsx](../frontend/src/components/analysis/SpeedProfileChart.tsx)): keeps one line per direction, and merges the two paths' bins at the same chainage (the loop) using an `n`-weighted mean.

Colours come from fixed class breaks in [metrics.ts](../frontend/src/lib/metrics.ts), so a given colour means the same value under every filter:

| Metric | Breaks |
|---|---|
| Speed | 6 / 12 / 18 / 24 mph |
| Occupancy | 20 / 40 / 60 / 80 % (the top class also covers values over 100%) |

## Caveats

### Merged medians are not true medians

When the map shows both directions, it combines the two bins for a stretch by taking an `n`-weighted average of each field. That is exact for means, but not for medians. A median depends on how all the individual values are ordered, and the two summary medians don't contain that information.

Example, with three fixes per direction on one stretch:

| | Speeds (m/s) | Mean | Median |
|---|---|---|---|
| Direction 0 | 2, 2, 10 | 4.67 | 2 |
| Direction 1 | 8, 9, 10 | 9 | 9 |
| **Combined (true)** | 2, 2, 8, 9, 10, 10 | **6.83** | **8.5** |
| **Merged by the frontend** | | **6.83** ✓ | **5.5** ✗ |

**Current impact: none.** The merged `medianMps` and `medianOccupancy` are computed in `toStretches()` but never displayed. The table shows `medianMps` per direction, straight from the API, so those values are exact. This only matters if a merged median is ever shown, for example in the map tooltip. At that point, either compute it in SQL without the direction split, or label it as approximate.

### Occupancy is weighted by fixes that may have no occupancy reading

`n` counts every fix in the bin, but `avg(occupancy_percentage)` ignores fixes where occupancy is null. So for occupancy, `n` can overstate how many readings the average is based on. That causes two problems:

1. **Merging can give the wrong weight.** Both the map (merging directions) and the chart (merging the two loop paths) weight each bin's `meanOccupancy` by `n`. Example:

   | | Fixes (`n`) | With occupancy | Mean occupancy |
   |---|---|---|---|
   | Direction 0 | 100 | 100 | 20% |
   | Direction 1 | 100 | 10 | 80% |
   | **Combined (true)** | | 110 | (100×20 + 10×80) / 110 = **25.5%** |
   | **Merged by `n`** | | | (100×20 + 100×80) / 200 = **50%** ✗ |

   Direction 1's average comes from only 10 readings but counts as if it came from 100.

2. **`minSamples` doesn't protect occupancy.** In the example, direction 1 passes `minSamples` = 20 with only 10 occupancy readings, so its 80% figure is shown as though it were well supported.

**Current impact: depends on how often occupancy is null, which hasn't been measured.** None, every row contains occupancy currently.

### Speed depends on the feed

`speed_mps` is whatever Swiftly reports. If that value is smoothed or lagged, the bins inherit it.

## Run-time histogram

`GET /api/analysis/run-times` ([runTimeRepository.ts](../backend/src/services/runTimeRepository.ts)) returns how long complete terminal-to-terminal runs take, bucketed per whole minute and per direction, with median and p10/p90.

- **Trip instances, not trip_ids.** Swiftly's `trip_id` repeats every service day, so per vehicle a new instance starts when `trip_id` or `direction_id` changes, or the feed is silent for over 5 minutes.
- **Run time** = first fix within 150 m of the destination terminal − last fix within 150 m of the origin terminal. Using the *last* origin fix keeps terminal layover out.
- Only instances that reach both terminal zones count, so short-turned trips drop out instead of looking fast. Runs outside 10–90 min are discarded as data faults.
- Date, direction and time-of-day filters apply to the **departure** time; the bin size doesn't apply. Same 6-hour window snapping, cache and warmer as the speed profile.
