---
name: start-app
description: Start the KC Streetcar Tracker locally — Postgres (Docker), the backend poller/API on :3001, and the frontend map on :5173 — then screenshot the running map.
---

# Start the KC Streetcar Tracker

Three processes must come up in order: **Postgres → backend → frontend**.
The backend poller pulls the live Swiftly GTFS-RT feed (real API key is
already in `backend/.env`) and writes to Postgres; the API serves it; the
frontend polls the API every 15s and draws the Leaflet map.

Run everything from the repo root unless a step says otherwise. Use the
Bash tool (POSIX). Send background process logs to the scratchpad dir.

## 1. Postgres (Docker)

```bash
docker info >/dev/null 2>&1 || {
  "/c/Program Files/Docker/Docker/Docker Desktop.exe" &
  for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 5; done
}
docker compose up -d
docker compose ps          # expect kc-streetcar-postgres-1 "Up", 0.0.0.0:5432->5432
```

## 2. Migrate

Idempotent (`CREATE TABLE IF NOT EXISTS`) — safe to run every start.

```bash
cd backend && npm run migrate    # -> "Migrations complete."
cd ..
```

## 3. Backend (poller + API) on :3001

```bash
LOG=<scratchpad>/backend.log
cd backend && nohup npm run dev > "$LOG" 2>&1 &
cd ..
sleep 10
tail -20 "$LOG"                                   # expect "API listening on http://localhost:3001"
                                                  # and "[poller] stored N position(s)"
curl -s http://localhost:3001/health              # {"ok":true}
curl -s http://localhost:3001/api/vehicles/live   # JSON array of streetcars (usually ~8)
```

If `npm install` hasn't been run: `cd backend && npm install` first.

## 4. Frontend (Vite + Leaflet) on :5173

```bash
LOG=<scratchpad>/frontend.log
cd frontend && nohup npm run dev > "$LOG" 2>&1 &
cd ..
sleep 8
tail -20 "$LOG"                     # expect "Local:   http://localhost:5173/"
```

If `npm install` hasn't been run: `cd frontend && npm install` first.

## 5. Screenshot the running map (drive it)

Chrome isn't installed on this box; Edge headless works. Use a
Windows-style path for `--screenshot` and a throwaway `--user-data-dir`,
or it silently writes nothing.

```bash
SS='C:\path\to\<scratchpad>\kc-app.png'
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1400,1000 \
  --user-data-dir='C:\path\to\<scratchpad>\edge-profile' \
  --virtual-time-budget=15000 \
  --screenshot="$SS" "http://localhost:5173/"
```

Then Read the PNG. A good result: light-gray basemap, blue streetcar route
from River Market to UMKC, white stop dots, and directional vehicle icons
whose count matches the `/api/vehicles/live` array.

## Stopping / restarting

`tsx watch` (backend, :3001) and `vite` (frontend, :5173) can leave a
`node` child holding the port after they're killed. If `npm run dev`
reports the port in use:

```bash
netstat -ano | grep -E ':(3001|5173)\s'   # find the PID in the last column
taskkill //F //PID <pid>
```

Leave the Postgres container running between restarts; `docker compose
down` only when you want a clean slate (the `pgdata` volume persists
history regardless).

## Troubleshooting

- **Backend logs `getaddrinfo ENOTFOUND api.goswift.ly` / feed errors** —
  no internet or the Swiftly key expired. API still serves whatever
  history is already in Postgres; the map may just be empty.
- **`/api/vehicles/live` returns `{"error":"internal server error"}`** —
  Postgres is down or the migration didn't run. Redo steps 1–2.
- **Map tiles blank but route/markers draw** — Esri tile host blocked;
  cosmetic only.
