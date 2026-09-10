# Deployment plan: Azure Container Apps + Neon

Live tracking doc for hosting the KC Streetcar Tracker. Check items off as we go.

## Target architecture

| Piece | Where | Cost |
|---|---|---|
| Frontend (`vite build` output) | Azure Static Web Apps (free tier) | $0 |
| Backend (Express + poller) | Azure Container Apps, Consumption plan, **1 replica pinned** | ~$4-6/mo |
| Database | Neon Postgres (free tier) | $0 |
| Image registry | GitHub Container Registry (ghcr.io) | $0 |
| CI/CD | GitHub Actions | $0 |

**Total ~ $4-6/mo**, essentially the 0.5 GiB memory floor on ACA.

### Key constraints

- The backend runs a poller every 15s, so it needs one always-on process: `minReplicas: 1`, no scale-to-zero.
- `maxReplicas: 1` as well. Two+ replicas = two pollers = duplicate rows every 15s. One instance is both correct and cheapest.

---

## Phase 0 - Code changes (needed for any host)

- [x] Fix the backend `start` script. `backend/package.json` said `node dist/index.js`, but with `rootDir: "."` the build emits `dist/src/index.js`. Now `node dist/src/index.js`.
- [x] API base URL in the frontend. `frontend/src/api/vehicles.ts` now prefixes requests with `import.meta.env.VITE_API_BASE_URL ?? ""`. Empty value locally -> relative path -> existing `vite.config.ts` dev proxy still works. Added `frontend/src/vite-env.d.ts` for the env type.
- [x] Added `VITE_API_BASE_URL=` to a new `frontend/.env.example`.
- [x] New `backend/Dockerfile` - multi-stage `node:22-alpine`: builder runs `npm ci` + `npm run build`; runtime does `npm ci --omit=dev`, copies `dist/`, and copies `db/migrations` -> `dist/db/migrations` (tsc does not copy `.sql`), then `CMD ["node", "dist/src/index.js"]`.
- [x] New `backend/.dockerignore` (`node_modules`, `dist`, `.env*`).
- [ ] CORS tightening (do in Phase 4). `backend/src/index.ts` uses wide-open `app.use(cors())`. Add a `CORS_ORIGIN` env var and restrict to the Static Web Apps URL.
- [ ] Neon SSL fallback (only if needed). `pg` 8.12 honors `?sslmode=require` in Neon's connection string, so likely no change. If `self-signed certificate` errors appear, add `ssl: { rejectUnauthorized: false }` to the `Pool` in `backend/src/db/pool.ts` and `backend/db/migrate.ts`.
- [x] Proved it locally: `docker build -t kc-streetcar-backend ./backend` succeeds; container starts, `/health` returns `{"ok":true}`, poller fails gracefully with no DB reachable (expected until Phase 1 points it at Neon).

## Phase 1 - Neon database

- [ ] Create a Neon project in a region near the Azure region (e.g. AWS `us-east-1` <-> Azure `eastus2`).
- [ ] Copy the **pooled** connection string (`...-pooler...?sslmode=require`).
- [ ] Run migrations from the laptop: `cd backend && DATABASE_URL="<neon-url>" npm run migrate`.
- [ ] Verify: `psql "<neon-url>" -c "\dt"` shows `vehicle_positions`.

## Phase 2 - Azure foundation

- [ ] `az login`; `az extension add --name containerapp --upgrade`; register providers `Microsoft.App` and `Microsoft.OperationalInsights`.
- [ ] `az group create -n kc-streetcar -l eastus2`
- [ ] `az containerapp env create -n kc-streetcar-env -g kc-streetcar -l eastus2` (Consumption plan - no management fee).

## Phase 3 - First backend deploy (manual, to learn the pieces)

- [ ] Push image to ghcr.io: `docker login ghcr.io`, tag + push `ghcr.io/<you>/kc-streetcar-backend:latest`, mark the package public (simplest pull auth).
- [ ] `az containerapp create` with: `--target-port 3001 --ingress external`, `--min-replicas 1 --max-replicas 1`, `--cpu 0.25 --memory 0.5Gi`, secrets for `SWIFTLY_API_KEY` and `DATABASE_URL`, env vars for those plus `GTFS_RT_URL`, `STREETCAR_ROUTE_ID=601`, `POLL_INTERVAL_MS=15000`, `PORT=3001`.
- [ ] Get the FQDN; check `https://<fqdn>/health` and `/api/vehicles/live`.
- [ ] Stream logs (`az containerapp logs show --follow`) and confirm `[poller] stored N position(s)`.
- [ ] Add a liveness probe on `/health`.

## Phase 4 - Frontend on Static Web Apps

- [ ] `az staticwebapp create` against the repo: `app_location=frontend`, `output_location=dist`, build `npm run build`. Auto-adds a `.github/workflows/azure-static-web-apps-*.yml`.
- [ ] Set `VITE_API_BASE_URL=https://<aca-fqdn>` as a build env var in that workflow.
- [ ] Set the backend's `CORS_ORIGIN` to the `*.azurestaticwebapps.net` URL and switch `cors()` -> `cors({ origin: ... })`.

## Phase 5 - CI/CD for the backend

- [ ] `.github/workflows/deploy-backend.yml`: on push to `main` under `backend/**` -> build, push `ghcr.io/...:${{ github.sha }}` and `:latest`, then `az containerapp update --image ...:${{ github.sha }}`.
- [ ] Auth via an Azure OIDC federated credential (no long-lived secret), stored as GitHub secrets.

## Phase 6 - Housekeeping

- [ ] Azure Cost Management billing alert at **$20**.
- [ ] Keep Log Analytics retention low (watch the 5 GB/mo free ingestion cap).
- [ ] Optional: custom domain (CNAME -> SWA for the app, subdomain -> ACA for the API; both get free managed certs).
- [ ] Optional: a scheduled `pg_dump` GitHub Action to blob storage if the position history matters.

---

## What each phase teaches

- **P0**: Docker multi-stage builds, `.dockerignore`, 12-factor config
- **P2-3**: resource groups, ACA environments, Consumption plan, secrets vs env vars, ingress, revisions, log streaming
- **P4**: static hosting, build-time env injection, CORS
- **P5**: GitHub Actions, OIDC-to-Azure (passwordless), image tagging by commit SHA
- **P6**: cost controls, observability limits, managed TLS/DNS

---

## Progress log

- 2026-09-09: Plan created.
- 2026-09-09: Phase 0 done. `start` script fixed, frontend API base URL wired (+ `vite-env.d.ts`, `.env.example`), `backend/Dockerfile` + `.dockerignore` added. Backend and frontend builds pass; image builds and runs (`/health` OK).
