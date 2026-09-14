---
name: stop-app
description: Stop the KC Streetcar Tracker's local dev session — kills the backend poller/API (:3001) and frontend (:5173) so they stop polling Swiftly. Use after testing locally, especially before/after a prod deploy, to avoid burning Swiftly's rate limit (180 req/15min - see README.md).
---

# Stop the KC Streetcar Tracker (local)

Kills the local backend and frontend dev servers so the local poller stops
hitting the Swiftly GTFS-RT feed. Run this whenever you're done testing
locally - the backend poller runs unattended otherwise and counts against
the same Swiftly rate limit as production.

Leaves the local Postgres container running (`docker compose`) - it doesn't
call Swiftly, and start-app's own notes say to leave it up between restarts.
Only stop it too if the user explicitly asks for a full teardown
(`docker compose down`).

## Steps

Both `tsx watch` (backend, :3001) and `vite` (frontend, :5173) can leave a
`node` child process holding the port even after the launching process
exits, so kill by the PID actually bound to the port rather than assuming a
process name:

```bash
netstat -ano | grep -E ':(3001|5173)\s.*LISTENING'
```

For each PID found, force-kill it:

```bash
taskkill //F //PID <pid>
```

Then confirm both ports are free:

```bash
netstat -ano | grep -E ':(3001|5173)\s.*LISTENING' || echo "both ports free"
```

If nothing was listening on either port to begin with, just report that -
no error, nothing to do.
