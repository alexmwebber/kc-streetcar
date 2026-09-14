# KC Streetcar Tracker

A web app that tracks the Kansas City Streetcar in real time and stores its position history for later analysis.

## Purpose

The KC Streetcar publishes live vehicle positions through a GTFS-Realtime feed (via Swiftly). This project:

1. **Polls** that feed every ~15 seconds to get live vehicle positions.
2. **Stores** every observation in a database, building up a historical record.
3. **Displays** current streetcar location(s) on a live map in the browser.
4. **Enables analysis** of historical data — e.g. average speed, on-time performance, dwell times at stops — by querying the stored history.

## Tech Stack

| Layer | Choice |
|---|---|
| Backend / poller / API | Node.js + TypeScript (Express) |
| Database | PostgreSQL |
| Frontend | React + Vite + Leaflet |
| Local Postgres | Docker Compose |

See [PROJECT_STRUCTURE.txt](PROJECT_STRUCTURE.txt) for the full directory layout.

### Why these choices

- **Node.js + TypeScript**: one language across the poller and the API, official `gtfs-realtime-bindings` package for parsing the protobuf feed, and typed end-to-end with the React frontend.
- **PostgreSQL**: industry-standard relational database, free, runs locally via Docker, and handles time-series-style queries (e.g. average speed over a time window) well. If the data volume grows significantly, the [TimescaleDB](https://www.timescale.com/) extension can be added later without changing the schema much.
- **React + Leaflet**: React per your preference/experience. Leaflet is a free, open-source mapping library that doesn't require an API key (unlike Mapbox or Google Maps), which keeps the frontend simple for a single live map.

## How it fits together

```
Swiftly GTFS-RT feed
        │  (polled every ~15s)
        ▼
  backend/ poller  ──────────────►  PostgreSQL (vehicle_positions table)
        │                                   ▲
        │                                   │ historical queries
        ▼                                   │
  backend/ API (Express)  ◄──────────────────┘
        │  (JSON over HTTP)
        ▼
  frontend/ React app (Leaflet map, polls the API every ~15s)
```

The poller and the API run in the same Node process for simplicity (see `backend/src/index.ts`). They can be split into separate services later if needed.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Docker](https://www.docker.com/) (for local PostgreSQL) — or a Postgres instance you already have
- A Swiftly API key for the KCATA GTFS-RT feed

### 1. Start the database

```bash
docker compose up -d
```

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
# edit .env and fill in SWIFTLY_API_KEY, DATABASE_URL, etc.
npm install
npm run migrate   # applies db/migrations/001_init.sql
npm run dev
```

The API will be available at `http://localhost:3001`.

### 3. Configure the frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

### Stop the backend when you're done developing

Swiftly rate-limits the GTFS-RT feed key to **180 requests / 15 minutes**. Production alone already uses about two-thirds of that: it polls both feeds (`gtfs-rt-vehicle-positions` + `gtfs-rt-trip-updates`) every 15s, which is 2 requests × 60 poll cycles = **120 requests / 15 min**. Leaving a local `npm run dev` backend running at the same time (same API key) adds another ~120 requests/15min on top — comfortably over the limit.

**Stop the local backend (`Ctrl+C`, or kill the process if it's running in the background) once you're done testing**, rather than leaving it polling unattended.

## Environment Variables

See `backend/.env.example` for the full list. Key ones:

- `SWIFTLY_API_KEY` — auth header value for the Swiftly GTFS-RT endpoints
- `GTFS_RT_BASE_URL` — base URL for KCATA's Swiftly feeds; `/gtfs-rt-vehicle-positions` and `/gtfs-rt-trip-updates` are appended to it
- `STREETCAR_ROUTE_ID` — the GTFS route_id to filter for (currently assumed `601` — verify against KCATA's `routes.txt`)
- `DATABASE_URL` — PostgreSQL connection string
- `POLL_INTERVAL_MS` — how often to poll the feed (default 15000)

## Status / Roadmap

- [x] Prototype script confirming the GTFS-RT feed is reachable and parseable (`test.py`, kept for reference)
- [x] Project scaffolded (this commit)
- [ ] Backend: implement poller loop + DB writes
- [ ] Backend: implement API endpoints (live positions, history, stats)
- [ ] Frontend: render live map
- [ ] Frontend: historical view / charts (e.g. average speed)
- [ ] Deployment
