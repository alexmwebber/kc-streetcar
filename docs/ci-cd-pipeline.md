# CI/CD Pipeline

This document describes how KC Streetcar Tracker is hosted and deployed. For the phased history of how this setup was built, including issues encountered along the way, see [deployment.md](./deployment.md).

## Quick reference

| Thing | Value |
|---|---|
| Frontend | https://proud-island-0a037380f.6.azurestaticapps.net |
| Backend API | https://kc-streetcar-api.mangoground-3203ab82.eastus2.azurecontainerapps.io |
| Resource group | `kc-streetcar` (East US 2) |
| Static Web App | `kc-streetcar-web` |
| Container App | `kc-streetcar-api` (Consumption plan, `kc-streetcar-env` environment) |
| Backend image | `ghcr.io/alexmwebber/kc-streetcar-backend` (public) |
| Database | Neon Postgres, project in `us-east-2` |
| Azure AD app (backend CI auth) | `kc-streetcar-github-actions`, client ID `09824957-b323-498c-a1fc-b041f534fb94` |
| Monthly budget alert | `kc-streetcar-monthly-20`, $20/mo, subscription-wide |

## Runtime architecture

```mermaid
flowchart LR
  Browser -->|HTTPS| SWA["Azure Static Web Apps<br/>kc-streetcar-web"]
  SWA -->|"fetch /api/vehicles/live<br/>(VITE_API_BASE_URL, baked in at build time)"| ACA["Azure Container Apps<br/>kc-streetcar-api"]
  ACA -->|poll every 15s| Swiftly["Swiftly GTFS-RT feed"]
  ACA -->|read / write| Neon[("Neon Postgres")]
```

The backend runs as a single always-on process that serves the `/api/vehicles/*` and `/health` routes and polls the GTFS-RT feed every 15 seconds in the background ([poller.ts](../backend/src/services/poller.ts)). The Container App is pinned to exactly one replica (`--min-replicas 1 --max-replicas 1`): scaling to zero would stop the poller, and more than one replica would produce duplicate polling and duplicate rows in Neon.

## Deploy pipeline

Two independent GitHub Actions workflows handle deployment, split by which part of the repository changed:

```mermaid
flowchart TD
  Push["git push to main"] --> SWAWorkflow["Azure Static Web Apps CI/CD<br/>(triggers on ANY push to main)"]
  Push --> Router{"backend/** or\nits own workflow file\nchanged?"}
  Router -->|yes| BackendWorkflow["Deploy Backend"]
  Router -->|no| Skip["(Deploy Backend does not run)"]

  SWAWorkflow --> Build1["npm ci && npm run build<br/>on ubuntu-latest<br/>(VITE_API_BASE_URL injected here)"]
  Build1 --> Deploy1["Azure/static-web-apps-deploy action<br/>uploads frontend/dist, skip_app_build: true"]
  Deploy1 --> SWAlive["Static Web App serves the new build"]

  BackendWorkflow --> Build2["docker build ./backend<br/>tag: commit SHA + latest"]
  Build2 --> Push2["push both tags to ghcr.io"]
  Push2 --> OIDC["azure/login via OIDC<br/>(federated credential, no stored secret)"]
  OIDC --> Update2["az containerapp update<br/>--image ...:&lt;commit sha&gt;"]
  Update2 --> ACAlive["New revision live, old one drained"]
```

**[azure-static-web-apps-proud-island-0a037380f.yml](../.github/workflows/azure-static-web-apps-proud-island-0a037380f.yml)** triggers on every push to `main`; it currently has no path filter, so a backend-only push also runs it. It builds the frontend on the standard `ubuntu-latest` runner rather than letting the deploy action delegate the build to Azure's own auto-builder ("Oryx"). Oryx's build container ships an older glibc than the Rollup native binary pulled in by `vite build` requires, which causes the build to fail (see deployment.md, Phase 4). Authentication uses a deployment token that Azure generated and stored as the `AZURE_STATIC_WEB_APPS_API_TOKEN_PROUD_ISLAND_0A037380F` repository secret when the Static Web App was created.

**[deploy-backend.yml](../.github/workflows/deploy-backend.yml)** triggers only on pushes touching `backend/**` (or the workflow file itself). It builds and pushes the Docker image tagged both `:latest` and `:<commit-sha>`, then updates the Container App to that exact SHA tag. Tagging by SHA, rather than only `:latest`, keeps the running image traceable to the exact commit that produced it and allows rollback without rebuilding (see Rolling back, below).

## Auth: how the backend pipeline reaches Azure

No Azure credential is stored in GitHub as a plain secret:

1. An Azure AD app registration (`kc-streetcar-github-actions`) has a **federated credential** trusting GitHub's OIDC issuer for a specific subject: `repo:alexmwebber@26013687/kc-streetcar@1347814895:ref:refs/heads/main` (GitHub includes immutable owner/repo IDs in this claim, not just names).
2. On each run, the GitHub Actions runner mints a short-lived OIDC token asserting that it is a run of that exact repository and branch. The `azure/login@v2` step exchanges it for an Azure access token; no password or secret is transmitted, and the token is valid only for that job run.
3. The app registration's service principal is granted the **Container Apps Contributor** role, scoped to the `kc-streetcar` resource group only (not the subscription), limiting it to managing Container Apps within that group.
4. `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` are stored as repository secrets. These are identifiers only (which app registration, tenant, and subscription to use) and do not by themselves grant access without a matching GitHub OIDC token for this repository and branch.

The frontend pipeline's authentication is simpler: a deployment token scoped to that one Static Web App, generated by Azure and stored as a secret automatically.

## Configuration and secrets

**Frontend (build-time only):** `VITE_API_BASE_URL` is set as an `env:` value on the workflow's build step and is inlined into the JS bundle by Vite at build time ([vehicles.ts](../frontend/src/api/vehicles.ts)). It is not configurable at runtime; a change to the backend URL requires rebuilding and redeploying the frontend.

**Backend (Container App env vars / secrets)**, set via `az containerapp update`:

| Name | Kind | Value |
|---|---|---|
| `SWIFTLY_API_KEY` | secret (`swiftly-key`) | Swiftly GTFS-RT API key |
| `DATABASE_URL` | secret (`db-url`) | Neon pooled connection string (`sslmode=require&channel_binding=require`) |
| `GTFS_RT_URL` | plain | Swiftly feed URL |
| `STREETCAR_ROUTE_ID` | plain | `601` |
| `POLL_INTERVAL_MS` | plain | `15000` |
| `PORT` | plain | `3001` |
| `CORS_ORIGIN` | plain | `https://proud-island-0a037380f.6.azurestaticapps.net` (defaults to `*` if unset - see [config.ts](../backend/src/config.ts)) |

## Making a change

Changes deploy automatically on push to `main`; there is no separate deploy step.

- Changes under `frontend/` trigger the Static Web Apps workflow, which rebuilds and redeploys (approximately 1-2 minutes).
- Changes under `backend/` trigger the Deploy Backend workflow, which builds a new image and rolls it into Container Apps (approximately 2-3 minutes).
- Changes to both trigger both workflows, which run independently and in parallel.

To test a backend change locally before pushing:
```
cd backend
npm run build
docker build -t kc-streetcar-backend .
docker run --rm -p 3001:3001 --env-file .env kc-streetcar-backend
```
For the frontend, `npm run dev` in `frontend/` uses the Vite dev proxy to `localhost:3001` (see [vite.config.ts](../frontend/vite.config.ts)), requiring no environment variable configuration for local development.

## Rolling back

**Backend** - two methods:
- *Without rebuilding:* every image is retained in `ghcr.io` tagged by commit SHA, so the Container App can be pointed directly at a known-good tag: `az containerapp update -n kc-streetcar-api -g kc-streetcar --image ghcr.io/alexmwebber/kc-streetcar-backend:<old-sha>`. This takes effect immediately and does not require a CI run.
- *Through the pipeline:* `git revert <bad-commit>` followed by a push rebuilds and redeploys the reverted code, and records the rollback in git history.

**Frontend:** `git revert` followed by a push is the standard method, since there is no separate image registry to reference an older build. The Azure portal also retains prior Static Web Apps deployments, which can be viewed without using git.

## Debugging a failed deploy

1. **GitHub Actions** (`github.com/alexmwebber/kc-streetcar/actions`) - both workflows log every step; a failed run links directly to the failing step's output.
2. **Backend runtime, once deployed:**
   - `az containerapp logs show -n kc-streetcar-api -g kc-streetcar --tail 50` - application logs (should show `API listening...` and steady `[poller] stored N position(s)` lines).
   - `az containerapp revision list -n kc-streetcar-api -g kc-streetcar -o table` - lists revision health and traffic weight, to confirm the new revision is receiving traffic.
   - `az containerapp show -n kc-streetcar-api -g kc-streetcar --query properties.template.containers[0]` - confirms the exact image, env vars, and probes currently live.
3. **Frontend deployment status:** `az staticwebapp environment list -n kc-streetcar-web -g kc-streetcar`. GitHub Actions logs are the primary debugging source for the frontend deployment; Azure's CLI provides less visibility into Static Web Apps than into Container Apps.

**Known failure modes** (see deployment.md for full details):
- `GLIBC_2.32' not found` during the frontend build - caused by Oryx's build container shipping an older glibc than the Rollup native binary requires. The workflow builds on `ubuntu-latest` directly to avoid this.
- `permission_denied: write_package` when pushing to ghcr.io - the package is not linked for this repository's Actions access. Resolve via package Settings → Manage Actions access → add the repository with Write access.
- `AADSTS700213: No matching federated identity record...` - the federated credential's subject does not match the value GitHub presents (for example, after a repository rename or transfer, or a change to GitHub's claim format). Resolve by reading the exact subject from the error and updating it with `az ad app federated-credential update`.
- An unescaped `&` (or `|`, `^`, `%`) in a value passed to `az` from PowerShell - split by the `cmd.exe` layer `az.cmd` runs through, corrupting the command. Resolve by placing the value in a JSON/YAML file and passing it via `--parameters @file`, `--body @file`, or `--yaml @file` instead of inlining it.

## Cost

Consumption-based, no fixed server cost:

| Piece | Cost |
|---|---|
| Container Apps (1 replica, 0.25 vCPU / 0.5 GiB, always on) | ~$4-6/mo |
| Static Web Apps (Free tier) | $0 |
| Neon Postgres (Free tier) | $0 |
| ghcr.io (public package) | $0 |
| **Total** | **~$4-6/mo** |

A $20/mo subscription-wide budget alert (`kc-streetcar-monthly-20`) sends notifications at 80% actual, 100% actual, and 100% forecasted spend to alexmwebber@gmail.com.
