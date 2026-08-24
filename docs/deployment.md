# Deployment Guide

This document explains how to run, deploy, and verify the Komponentdatabase prototype.

## Deployment Overview

The app has two deployed parts:

| Part | Host | Source |
| --- | --- | --- |
| Frontend | GitHub Pages | `index.html`, `styles.css`, `app.js`, `assets/`, `docs/` |
| Backend | Cloudflare Workers + D1 | `backend/src/index.js`, `backend/migrations/`, `backend/wrangler.toml` |

The frontend is static. The backend owns authentication and shared data.

For production planning, read this deployment guide together with:

- [Production Readiness Roadmap](production-readiness.md)
- [Security and Access Model](security.md)
- [Production Data Model Proposal](data-model.md)

## Environment Strategy

Production should not share database, secrets, or access policy with development.

Recommended environments:

| Environment | Frontend | Worker | Database | Purpose |
| --- | --- | --- | --- | --- |
| `dev` | local or dev URL | dev Worker | dev D1 | active development |
| `test` | staging URL | test Worker | test D1 | migration rehearsal and user acceptance |
| `prod` | production URL | prod Worker | prod D1 | real daily use |

Each environment should have separate:

- `wrangler.toml` config or Wrangler environment block
- D1 database binding
- `TOKEN_SECRET`
- `ALLOWED_ORIGINS`
- Cloudflare Access application and policy
- backup/export routine

Avoid connecting local development directly to the production D1 database.

## Local Frontend

From the repository root:

```bash
node server.js
```

Open:

```text
http://localhost:3000
```

To use another port:

```bash
PORT=5500 node server.js
```

PowerShell:

```powershell
$env:PORT = "5500"
node server.js
```

## Frontend API Configuration

`index.html` contains:

```html
<script>
  window.COMPONENT_APP_API = "https://komponent-blanket-backend.nicklas-jensen-n.workers.dev";
</script>
```

If this value is empty, the frontend uses local `localStorage` mode.

If this value is set, the frontend uses cloud mode and users must log in.

## GitHub Pages Deployment

This repository is deployed as a static GitHub Pages site.

Typical workflow:

```bash
git status
git add .
git commit -m "Describe the change"
git push origin main
```

GitHub Pages serves the latest pushed static files from the configured branch/folder.

Use a cache-buster when verifying:

```text
https://respawnedx.github.io/komponent-blanket-app-v7/?v=<commit>
```

Example:

```text
https://respawnedx.github.io/komponent-blanket-app-v7/?v=a5d2e6d
```

## Cloudflare Worker Setup

Install Wrangler if needed:

```bash
npm install -g wrangler
wrangler login
```

From `backend/`:

```bash
wrangler deploy
```

Current Worker route:

```text
https://komponent-blanket-backend.nicklas-jensen-n.workers.dev
```

## D1 Database Setup

Create a D1 database:

```bash
wrangler d1 create komponent_db
```

Copy the generated `database_id` into `backend/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "komponent_db"
database_id = "..."
```

Apply migrations:

```bash
wrangler d1 migrations apply komponent_db --remote
```

Migrations create:

- `users`
- `records`
- `audit`
- `login_throttle`

## Required Secret

Set `TOKEN_SECRET`:

```bash
wrangler secret put TOKEN_SECRET
```

Use a long random value. Authenticated routes now fail with HTTP 500 if this secret is missing, because signing tokens with an implicit fallback would be unsafe.

Example secret generation with Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Worker Variables

`backend/wrangler.toml` contains:

```toml
[vars]
ALLOWED_ORIGINS = "https://respawnedx.github.io,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500"
TOKEN_TTL_SECONDS = "604800"
```

`ALLOWED_ORIGINS` is required for browser access. The Worker no longer allows every arbitrary browser origin when this list is empty.

`TOKEN_TTL_SECONDS` controls bearer-token lifetime.

Production should use environment-specific values. Do not keep localhost origins in the production allowlist unless there is a deliberate support process that requires it.

## First Admin User

The UI can manage users only after the first admin exists.

Generate SQL:

```bash
node backend/bootstrap-admin.js NJ 1234 nijey@arlafoods.com
```

Run the SQL in the D1 console or with `wrangler d1 execute`.

After that, log in and use **Brugere** in the app.

## Current Test Users

Prototype/demo users commonly used during testing:

| Login | Password | Role |
| --- | --- | --- |
| `VIEW` | `1234` | `user` |
| `PLAN` | `1234` | `allocator` |
| `NJ` | `1234` | `admin` |

Do not use these defaults for a real production rollout.

For production, prefer Microsoft Entra ID / Cloudflare Access instead of local demo users. See [Security and Access Model](security.md).

## Verification Checklist

After changes:

```bash
node --check app.js
node --check backend/src/index.js
node --check server.js
git diff --check
```

Run the Playwright smoke test from the external work folder used during development:

```powershell
$env:UI_URL = "http://localhost:5500/?v=local-check"
.\node_modules\.bin\playwright.cmd test .\ui-check.spec.js --reporter=line
```

Live verification:

```powershell
$env:UI_URL = "https://respawnedx.github.io/komponent-blanket-app-v7/?v=<commit>"
.\node_modules\.bin\playwright.cmd test .\ui-check.spec.js --reporter=line
```

Health check:

```bash
curl https://komponent-blanket-backend.nicklas-jensen-n.workers.dev/health
```

## Production Deployment Checklist

Before real production use:

- [ ] `dev`, `test`, and `prod` environments are separated.
- [ ] Production `ALLOWED_ORIGINS` only contains approved production frontend URLs.
- [ ] Production `TOKEN_SECRET` is unique and stored only as a Cloudflare secret.
- [ ] Cloudflare Access protects the production frontend/API.
- [ ] Microsoft Entra ID groups or app roles map to `VIEW`, `PLAN`, and `ADMIN`.
- [ ] Cloudflare WAF/rate limiting is configured for login and relevant API routes.
- [ ] Demo users/passwords are removed from production.
- [ ] D1 export/restore has been tested.
- [ ] Access migration has been dry-run in `test`.
- [ ] Smoke tests pass against the production URL after deployment.
- [ ] Rollback steps are documented before importing production data.

## D1 Backup And Restore Notes

For production backup, do not rely only on the UI **Backup JSON** button. Use database-level export as the main safety layer.

Example D1 export:

```bash
npx wrangler d1 export komponent_db --remote --output=./komponent_db.sql
```

Example restore/import into another database:

```bash
npx wrangler d1 execute komponent_db_test --remote --file=./komponent_db.sql
```

Use a tested restore procedure before large imports or migration work. Cloudflare also documents D1 Time Travel/backups; check the current Cloudflare account/database support before relying on a retention window.
