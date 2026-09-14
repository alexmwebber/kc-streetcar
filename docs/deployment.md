# Deployment plan: Azure Container Apps + Neon

Live tracking doc for hosting the KC Streetcar Tracker. Check items off as we go.

For a description of how the finished pipeline actually works day to day (not the setup history), see [ci-cd-pipeline.md](./ci-cd-pipeline.md).

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
- [x] CORS tightening - done in Phase 4 (`CORS_ORIGIN`, restricted to the Static Web Apps URL), then extended to a comma-separated multi-origin list during the custom domain work (Phase 6) once there were two frontend origins to allow.
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

- [x] Azure AD app registration `kc-streetcar-github-actions` (client ID `09824957-b323-498c-a1fc-b041f534fb94`) + service principal, role **Container Apps Contributor** scoped to just the `kc-streetcar` resource group (not subscription-wide).
- [x] Federated OIDC credential on the app registration (issuer `token.actions.githubusercontent.com`) - no client secret stored anywhere.
- [x] Added `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` as GitHub repo secrets (identifiers, not credentials by themselves - useless without GitHub's per-run OIDC token).
- [x] `.github/workflows/deploy-backend.yml`: on push to `main` touching `backend/**` -> build, push `ghcr.io/...:${{ github.sha }}` and `:latest`, `azure/login@v2` (OIDC), `az containerapp update --image ...:${{ github.sha }}`.
- [x] Verified: pushing the workflow file itself triggered a real run; `az containerapp show` confirms the running image tag matches the commit SHA CI built; `/health` and `/api/vehicles/live` still good after the CI-driven rollout.

> **Gotcha 1 - GHCR "permission_denied: write_package".** The `kc-streetcar-backend` package was first created via a manual `docker push` (Phase 3, personal PAT), so it wasn't linked to the repo for `GITHUB_TOKEN` pushes even with `permissions: packages: write` in the workflow. Fixed on GitHub: package Settings -> Manage Actions access -> Add Repository `kc-streetcar` -> role Write.
>
> **Gotcha 2 - OIDC subject mismatch.** `AADSTS700213: No matching federated identity record...`. GitHub's actual subject claim included immutable owner/repo IDs - `repo:alexmwebber@26013687/kc-streetcar@1347814895:ref:refs/heads/main` - not the plain `repo:alexmwebber/kc-streetcar:ref:refs/heads/main` used when creating the credential. Fixed with `az ad app federated-credential update --subject <the exact value from the error message>`. Lesson: don't guess the subject format - trust what Azure's error actually reports back.

## Phase 6 - Housekeeping

- [x] Azure Cost Management budget `kc-streetcar-monthly-20`: **$20/month**, subscription-wide scope (not just the resource group, so it catches anything created anywhere in the account), alerts to alexmwebber@gmail.com at 80% actual, 100% actual, and 100% forecasted. `az consumption budget create` (the CLI command) doesn't support `--notifications` or `--scope` in the installed CLI version (preview command, limited) - created via `az rest --method put` against the Consumption budgets REST API directly instead, body supplied from a file (same `@file` pattern as the federated credential, for the same reason: avoid shell quoting).
- [x] Log Analytics retention - checked via `az monitor log-analytics workspace show`: already at 30 days, the minimum configurable for this workspace SKU (`PerGB2018`). No change needed; still worth watching the 5 GB/mo free ingestion cap if logs volume ever grows.
- [x] **Custom domain.** Registered `streetcartracker.com` via Cloudflare. Frontend: apex domain, TXT validation (`az staticwebapp hostname set --validation-method dns-txt-token`) plus a root CNAME to the default hostname (Cloudflare flattens it). Backend: `api.streetcartracker.com`, CNAME to the Container App's default hostname plus an `asuid.api` TXT record for hostname ownership, then a managed certificate bound via `az containerapp hostname bind`. Updated `CORS_ORIGIN` (now comma-separated, supports multiple origins - see [config.ts](../backend/src/config.ts)) and `VITE_API_BASE_URL` to the new domains; both redeployed automatically through the Phase 5 CI/CD pipeline. All DNS records were verified independently via `Resolve-DnsName ... -Server 1.1.1.1` before trusting Azure's own (much slower) validation polling.
  >
  > **Gotcha - managed certificate TXT validation kept timing out.** `az containerapp hostname bind --validation-method TXT` failed 3 times in a row with `Operation timed out` even though the TXT record was confirmed live in DNS. Root cause: each attempt creates a **new** managed-certificate resource with its own one-time validation token, and Azure's domain-control-validation window is apparently much shorter than the "up to 20 minutes" issuance estimate suggests - shorter, in practice, than the round-trip time of a human reading the token, adding it in Cloudflare, and confirming back. Fix: switch to `--validation-method CNAME` instead. Since a CNAME for `api.streetcartracker.com` already pointed at the Container App, Azure could validate domain control against it immediately with no new record or waiting required - bound successfully on the first try. Lesson: prefer CNAME validation over TXT when a suitable CNAME already exists; TXT DCV is worth using only when there's no way to point a CNAME at the target ahead of time. Also: each failed attempt's certificate resource has to be deleted (`az containerapp env certificate delete`) before retrying, or it just piles up abandoned `Failed` certificates.
- [x] Scheduled database backups - [backup-db.yml](../.github/workflows/backup-db.yml): daily `pg_dump` (+ manual `workflow_dispatch`), uploaded as a GitHub Actions artifact (30-day retention). Chose Actions artifacts over a separate object store (e.g. Cloudflare R2) since the data volume is tiny and it needs zero new accounts/credentials; revisit if that stops being true. Uses Neon's *direct* (non-pooled) connection string - `pg_dump` doesn't reliably work over PgBouncer's transaction pooling mode.
  >
  > **Gotcha - first run "succeeded" with a useless 184-byte backup.** `pg_dump` failed with `aborting because of server version mismatch` (Neon runs Postgres 18; Ubuntu's default `apt` package installs `pg_dump` 16, which refuses to dump a newer server) - but the workflow step still reported success, because `pg_dump ... | gzip > file` masks a failing `pg_dump`'s exit code behind `gzip`'s own (which "succeeds" compressing empty input). Fixed both problems: switched to running `pg_dump` from the official `postgres:18-alpine` image via `docker run` (guarantees a matching client version - bump the tag if Neon's major version ever changes) instead of apt, and added `set -euo pipefail` so a pipeline failure actually fails the step loudly going forward. Re-ran and got a real 3.4 MB dump. Lesson: a green checkmark on a backup job isn't proof of a good backup - check the artifact size/content, not just the exit status.
- [x] `www.streetcartracker.com` - CNAME (proxied) + a Cloudflare Redirect Rule to 301 it to the apex, rather than adding it as a second Azure custom domain (avoids another managed-certificate dance for a plain redirect).
- [x] Cloudflare Email Routing enabled - `contact@streetcartracker.com` forwards to alexmwebber@gmail.com. Cloudflare manages the MX/SPF records for this automatically.
- [x] DMARC record added: `_dmarc.streetcartracker.com` TXT `v=DMARC1; p=reject; rua=mailto:alexmwebber@gmail.com`. Verified resolving via `Resolve-DnsName ... -Server 1.1.1.1`.

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
- 2026-09-11: Site showed SWA's placeholder after Phase 4 ("check back later") - diagnosed via the GitHub Actions API (all 4 deploys had failed on an Oryx/Rollup glibc mismatch) and fixed by building the frontend ourselves in the workflow instead of relying on Oryx (see note above). Confirmed fixed via the served page's actual `<title>`.
- 2026-09-11: Custom domain decision logged as a planned Phase 6 item (not owned yet, will register one) - do it after Phase 5, covering frontend + backend in one pass.
- 2026-09-11: Phase 5 done. Backend CI/CD live: OIDC app registration + federated credential + scoped role assignment, `deploy-backend.yml` builds/pushes/deploys on every push touching `backend/**`. Hit and fixed two real gotchas (GHCR Actions-access linking, OIDC subject claim format - see notes above); confirmed end-to-end by matching the running container's image tag to the commit SHA CI built. Both frontend and backend now deploy automatically on `git push`. Remaining: Phase 6 (billing alert, custom domain once registered, optional backups).
- 2026-09-11: Billing alert set up (Phase 6, done early since it's quick and worth having ASAP). `az consumption budget create` turned out too limited (no `--notifications`/`--scope` in this CLI version) - used `az rest` against the Consumption REST API directly instead. $20/mo, subscription-wide, alerts at 80%/100% actual and 100% forecasted.
- 2026-09-14: Custom domain `streetcartracker.com` (registered via Cloudflare) wired up for both frontend and backend, with managed TLS certificates on both. Hit and fixed a real gotcha with managed-certificate TXT validation timing out repeatedly - switched to CNAME validation instead (see note above). CORS and the frontend's API base URL updated to the new domains and redeployed through the existing CI/CD pipeline. Remaining Phase 6 items: Log Analytics retention, optional scheduled backups.
- 2026-09-14: `www.streetcartracker.com` fixed (Cloudflare Redirect Rule was matching on the wrong field - "URI Full" instead of "Hostname" - so it never fired and requests fell through to a raw Azure 404). Cloudflare Email Routing enabled with a DMARC record. Scheduled backups added and fixed after the first run silently produced a useless 184-byte artifact (pg_dump/server version mismatch masked behind a pipe - see note above); re-verified with a real 3.4 MB dump. **All checklist items across all phases are now complete.**
