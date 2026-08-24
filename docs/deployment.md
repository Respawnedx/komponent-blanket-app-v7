# Deployment Guide

This document explains how to run, deploy, and verify the Komponentdatabase prototype.

## Deployment Overview

The app has two deployed parts:

| Part | Host | Source |
| --- | --- | --- |
| Frontend | GitHub Pages | `index.html`, `styles.css`, `app.js`, `assets/`, `docs/` |
| Backend | Cloudflare Workers + D1 | `backend/src/index.js`, `backend/migrations/`, `backend/wrangler.toml` |

The frontend is static. The backend owns authentication and shared data.

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

## Recommended Production Hardening

Before production use:

- Add Cloudflare WAF/rate limiting for `POST /auth/login`.
- Replace local passwords with Microsoft Entra ID / SSO if possible.
- Add CI for syntax checks, smoke tests, and Worker deployment.
- Create environment-specific Worker configs.
- Add backup/export routines for D1.
- Add a proper migration pipeline from Access.
- Add structured monitoring and alerting.
