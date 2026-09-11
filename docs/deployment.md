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
- [x] Neon SSL fallback - not needed. `pg` connects fine with `?sslmode=require&channel_binding=require` from Neon (current `pg` treats `sslmode=require` as `verify-full`; Neon's cert is publicly trusted). Harmless deprecation warning about future `pg` v9 semantics - no code change.
- [x] Proved it locally: `docker build -t kc-streetcar-backend ./backend` succeeds; container starts, `/health` returns `{"ok":true}`, poller fails gracefully with no DB reachable (expected until Phase 1 points it at Neon).

## Phase 1 - Neon database

- [x] Created Neon project in `us-east-2` (AWS), Postgres only (no object storage / functions / auth). Pairs with Azure `eastus2`.
- [x] Have the **pooled** connection string (host contains `-pooler`, `neondb` database, `neondb_owner` role).
- [x] Ran migrations from the laptop: `cd backend && DATABASE_URL="<neon-url>" npm run migrate` -> "Migrations complete."
- [x] Verified: `vehicle_positions` exists with all 15 columns and 3 indexes (`_pkey`, `_feed_timestamp`, `_vehicle_time`); 0 rows.

> The connection string was shared in chat during setup. If that's a concern, reset the `neondb_owner` password in the Neon console (Dashboard -> Roles) and update the ACA secret in Phase 3.

## Phase 2 - Azure foundation

- [x] `az login` (Azure free trial account; remember to upgrade the same subscription to Pay-As-You-Go before the 30-day/$200 trial ends, or resources pause). `az extension add --name containerapp --upgrade` (v1.3.0b5, preview). Registered providers `Microsoft.App` and `Microsoft.OperationalInsights`.
- [x] `az group create -n kc-streetcar -l eastus2`
- [x] `az containerapp env create -n kc-streetcar-env -g kc-streetcar -l eastus2` (Consumption plan - no management fee). Auto-created Log Analytics workspace `workspace-kcstreetcarW4xM`.

> Note: on this machine `az` wasn't on PATH in scripted shells even though it worked in an interactive `cmd`/PowerShell window right after install - it's at `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`. A fresh terminal window should have it on PATH already.

## Phase 3 - First backend deploy (manual, to learn the pieces)

- [x] Pushed image to ghcr.io: `ghcr.io/alexmwebber/kc-streetcar-backend:latest` (manual PAT-based login, then decided to make the package **public** rather than keep a long-lived registry pull credential).
- [x] `az containerapp create` with `--target-port 3001 --ingress external`, `--min-replicas 1 --max-replicas 1`, `--cpu 0.25 --memory 0.5Gi`.
- [x] FQDN: `https://kc-streetcar-api.mangoground-3203ab82.eastus2.azurecontainerapps.io`. `/health` -> `{"ok":true}`, `/api/vehicles/live` -> real streetcar positions.
- [x] Streamed logs (`az containerapp logs show`) - confirmed steady `[poller] stored 8 position(s)` every ~15s, no errors.
- [x] Added an HTTP liveness probe on `/health` (port 3001, 5s initial delay, 30s period) via the same YAML-update approach.

> **Gotcha - `&` in a secret value on Windows.** The Neon connection string has `&channel_binding=require`. Passing it straight on the `az containerapp create` command line from PowerShell got split there: `az.cmd` is a batch-file wrapper that re-parses the command through `cmd.exe`, which treats an unescaped `&` as a command separator - even inside a quoted PowerShell string. The result was a truncated `db-url` secret and every `--env-vars` flag silently dropped (they were part of the "second command" that then failed with `'channel_binding' is not recognized...`). Diagnosed via `az containerapp show --query "properties.template.containers[0].env"` returning `null`.
>
> **Fix used:** write the secrets/env vars into a local YAML file and apply with `az containerapp update --yaml <path>` - the values never touch the shell's command-line parser at all. Keep such files **outside the repo** (used the scratchpad temp dir here) since they contain plaintext secrets, and delete them after applying.
>
> Carry this forward into Phase 5: don't put secret values with `&`/`|`/`^`/`%` directly in a GitHub Actions `run:` line either - pass them as env vars or through `--yaml`/a file.

## Phase 4 - Frontend on Static Web Apps

- [x] `az staticwebapp create -n kc-streetcar-web -g kc-streetcar -l eastus2 -s <repo> --branch main --app-location frontend --output-location dist --login-with-github`. Needed `Microsoft.Web` provider registration first (same "new subscription, unregistered provider" pattern as Phase 2). GitHub device-code auth (interactive - visited github.com/login/device) since the repo is private. Site: `https://proud-island-0a037380f.6.azurestaticapps.net`.
- [x] Azure auto-committed `.github/workflows/azure-static-web-apps-proud-island-0a037380f.yml` **directly to origin/main** via its own GitHub integration - diverged from local main (which had unpushed Phase 2/3 commits). Merged and pushed to reconcile.
- [x] Added `VITE_API_BASE_URL` as a build-time `env:` on the workflow's `Build And Deploy` step (Oryx inherits the step's process env when it runs `npm run build`).
- [x] Backend: added `CORS_ORIGIN` config (defaults to `*` locally), `cors({ origin: config.corsOrigin })`. Rebuilt image, tagged by commit SHA (`840a78f`, not just `:latest` - more traceable, same pattern Phase 5 will automate), pushed, rolled out via `az containerapp update --image ... --set-env-vars CORS_ORIGIN=...`.
- [x] Verified: new revision `--0000003` healthy at 100% traffic; CORS preflight from the SWA origin returns that exact origin (not `*`); `/api/vehicles/live` works with the SWA `Origin` header; frontend root returns 200.

> **Gotcha - local git couldn't push at all.** `~/.gitconfig` had a corrupted `credential.helper=cache --timeout=30000000000000000` (out of int range), which broke every `git fetch`/`push` from the CLI while GitHub Desktop kept working fine (it manages its own credentials separately). Fixed with `git config --global credential.helper manager`, matching the system-level default.

> **Gotcha - site showed SWA's "check back later" placeholder.** All 4 auto-deploys since creation had actually failed (checked via the GitHub Actions API): Oryx's build container's glibc predates what the Rollup native binary `vite build` pulls in (`GLIBC_2.32' not found` - a known Oryx/Rollup friction point, not our code). Fixed by building on the standard `ubuntu-latest` runner ourselves (`actions/setup-node@v4` + `npm ci && npm run build`) and handing the deploy action the finished `frontend/dist` with `skip_app_build: true`, bypassing Oryx entirely. Verified via the run's actual conclusion (`success`) and the served page's `<title>`, not just an HTTP 200 (SWA returns 200 for the placeholder too).

## Phase 5 - CI/CD for the backend

- [ ] `.github/workflows/deploy-backend.yml`: on push to `main` under `backend/**` -> build, push `ghcr.io/...:${{ github.sha }}` and `:latest`, then `az containerapp update --image ...:${{ github.sha }}`.
- [ ] Auth via an Azure OIDC federated credential (no long-lived secret), stored as GitHub secrets.

## Phase 6 - Housekeeping

- [ ] Azure Cost Management billing alert at **$20**.
- [ ] Keep Log Analytics retention low (watch the 5 GB/mo free ingestion cap).
- [ ] **Custom domain (planned, not optional-forgotten)** - replace `proud-island-0a037380f.6.azurestaticapps.net` / `kc-streetcar-api.mangoground-3203ab82.eastus2.azurecontainerapps.io` with something recognizable. Decided 2026-09-11 to do this *after* Phase 5, as one pass covering both frontend and backend rather than piecemeal. Don't own a domain yet - need to register one first (that's the blocking prerequisite, not anything Azure-side). Once registered: CNAME -> SWA for the app, a subdomain -> ACA for the API; both get free managed certs automatically.
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
- 2026-09-09: Phase 1 done. Neon project created (`us-east-2`, Postgres only). Migration applied against Neon; schema verified (`vehicle_positions`, 15 cols, 3 indexes, 0 rows). No SSL code change needed. Next: Phase 2 (Azure CLI + resource group + Container Apps environment).
- 2026-09-11: Phase 2 done. Azure free-trial account created, `az` CLI installed and logged in, `containerapp` extension added, providers registered, `kc-streetcar` resource group and `kc-streetcar-env` Container Apps environment created in `eastus2`. Next: Phase 3 (push image to ghcr.io, `az containerapp create`).
- 2026-09-11: Phase 3 done. Image pushed to `ghcr.io/alexmwebber/kc-streetcar-backend:latest` (public package). `kc-streetcar-api` Container App live at `https://kc-streetcar-api.mangoground-3203ab82.eastus2.azurecontainerapps.io` - `/health` and `/api/vehicles/live` both returning real data, poller confirmed running in logs, liveness probe added. Hit and fixed a Windows/PowerShell gotcha where an unescaped `&` in the DATABASE_URL secret split the `az containerapp create` command (see note above) - resolved by applying config via `az containerapp update --yaml`. Next: Phase 4 (Static Web Apps frontend).
- 2026-09-11: Phase 4 done. Static Web App `kc-streetcar-web` live at `https://proud-island-0a037380f.6.azurestaticapps.net`, connected to the backend with `VITE_API_BASE_URL` baked in at build time and `CORS_ORIGIN` locked down on the API side. Fixed a broken global git credential helper along the way (see note above) and reconciled a divergent origin/main caused by Azure's GitHub integration committing the workflow file directly. Full chain verified: frontend -> API -> Neon. Next: Phase 5 (CI/CD for the backend).
