# Komponentdatabase

A browser-based prototype for Arla Foods Ingredients / Danmark Protein component-number management.

The app is built to demonstrate how the old component blanket and Access-based workflow can be replaced by a shared web system that prevents duplicate numbering, reserves project numbers, keeps revision history, and supports later migration work.

## What This Prototype Does

- Lets users search component records by main number, PID, plant, description, or full tag.
- Shows setup-number ranges across `0xx` through `9xx`.
- Tracks number states as business statuses:
  - `I brug` for active numbers that block reuse.
  - `Projekt` for temporary project reservations that also block reuse.
  - `Frigivet` for released/renumbered numbers that remain visible in history but do not block availability.
  - `Scan/import` as a source marker for numbers imported from paper, Access, Excel, or CSV.
- Calculates free numbers in the active series.
- Suggests suffix rows that are free across all series, so matrix-style rows are preserved.
- Autosaves and logs status changes.
- Keeps manual revision descriptions for deliberate master-data saves.
- Supports Cloudflare Workers + D1 for shared records and user access.
- Supports JSON backup, Access/Excel/CSV tag-list import, selected-record Excel export, and print/PDF output.

## Live Deployment

Frontend:

```text
https://respawnedx.github.io/komponent-blanket-app-v7/
```

Backend Worker:

```text
https://komponent-blanket-backend.nicklas-jensen-n.workers.dev
```

The frontend API URL is configured in `index.html` through `window.COMPONENT_APP_API`.

## Repository Map

```text
.
├── index.html                  # Static HTML shell and modal markup
├── styles.css                  # Full UI styling and print layout
├── app.js                      # Frontend orchestration, rendering, auth, import, autosave
├── src/                        # Shared browser modules used by app.js
│   ├── export.js               # Print, Excel export, and JSON backup helpers
│   ├── numbering.js            # Number, PID, date, and tag-format helpers
│   ├── permissions.js          # Role and permission helpers
│   ├── revisions.js            # Revision diffing/render helpers
│   ├── scan.js                 # Paper scan checkbox detection helpers
│   └── status.js               # Status normalization and labels
├── tests/
│   └── ui-smoke.spec.js        # Playwright smoke test
├── scripts/                    # Check, link, and D1 backup helpers
├── examples/                   # Import and backup example files
├── .github/workflows/ci.yml    # GitHub Actions CI
├── package.json                # Developer scripts and test dependencies
├── server.js                   # Dependency-free local static server
├── data/records.json           # Local server data placeholder
├── assets/
│   └── afi-logo.png
├── docs/
│   ├── architecture.md         # Main programmer guide
│   ├── deployment.md           # GitHub Pages + Cloudflare setup/runbook
│   ├── production-readiness.md # Roadmap from prototype to production
│   ├── security.md             # Enterprise auth, roles, WAF, audit, secrets
│   ├── data-model.md           # Recommended production database model
│   ├── import-formats.md       # Access/Excel/CSV and JSON backup formats
│   └── review-notes.md         # Current review status and handover notes
└── backend/
    ├── README.md               # Worker-specific setup notes
    ├── bootstrap-admin.js      # Generates first-admin SQL
    ├── wrangler.toml           # Worker, D1, CORS, and variable config
    ├── migrations/
    │   ├── 001_init.sql
    │   ├── 002_users_email.sql
    │   └── 003_login_throttle.sql
    └── src/
        └── index.js            # Cloudflare Worker API
```

## Documentation

Start here if you are a developer taking over the project:

- [Architecture Guide](docs/architecture.md)
- [Production Readiness Roadmap](docs/production-readiness.md)
- [Security and Access Model](docs/security.md)
- [Production Data Model Proposal](docs/data-model.md)
- [Deployment Guide](docs/deployment.md)
- [Import and Backup Formats](docs/import-formats.md)
- [Review Notes](docs/review-notes.md)
- [Backend README](backend/README.md)

## Access Levels

The app has three user roles:

| Role | UI Label | Intended User | Access |
| --- | --- | --- | --- |
| `user` | `VIEW` | Viewer / normal lookup user | Search, view, print, and export selected records. No editing. |
| `allocator` | `PLAN` | Planner / semi-admin | Can reserve and remove orange `Projekt` numbers. Can create new records only with project reservations. |
| `admin` | `ADMIN` | System owner / data maintainer | Full access: master data, all statuses, scan/import, JSON backup, delete, and user management. |

The frontend hides buttons based on role, and the Worker enforces the same role rules server-side.

## Number Model

Each record represents one main component number (`Hovedkomponentnr.`). Setup numbers are stored as strings:

- `01` through `99` for the `0xx` series.
- `101` through `999` for the `1xx` through `9xx` series.

Each selected setup number has metadata in `codeMeta`, including:

- status (`blue`, `reserved`, `red`)
- source (`manual` or `scan`)
- user initials
- timestamp
- PID binding if more than one PID is written on the record

Availability only treats `I brug` and `Projekt` as blocking. `Frigivet` is historical and does not block reuse.

## Save and Revision Behavior

Status changes are autosaved after a short debounce and get automatic revision entries. This means changes between blank, `I brug`, `Projekt`, and `Frigivet` are logged even if the user forgets to press **Gem ændringer**.

If the user presses **Gem ændringer** after an autosaved status change and only adds the project description, the app annotates the latest autosave revision instead of creating a separate `Ingen tag-ændringer` revision. This keeps the project name together with the reserved/released numbers it belongs to.

Master-data fields such as description, plant, PID, and signature are kept as a local draft until the user presses **Gem ændringer**. If a draft or autosave is pending, the browser shows its standard close/refresh warning.

The Worker uses optimistic concurrency. When the frontend saves a record, it sends the `updatedAt` timestamp it originally loaded. If the D1 row has changed since then, the Worker returns `409 Conflict` instead of silently overwriting another user's work.

## Running Locally

No npm install is required just to serve the app itself.

```bash
node server.js
```

Then open:

```text
http://localhost:3000
```

For cloud-connected local testing, make sure `ALLOWED_ORIGINS` in `backend/wrangler.toml` includes the local origin you use, for example `http://localhost:3000` or `http://localhost:5500`.

For development checks and Playwright tests:

```bash
npm install
npm run check
npm run test:ui
```

`npm run test:ui` runs in local fallback mode by default, so it does not depend on live Cloudflare data. To smoke-test the live deployment:

```bash
npm run test:ui:live
```

## Cloudflare Backend

The Worker provides:

- `POST /auth/login`
- `GET /auth/me`
- `GET /admin/users`
- `POST /admin/users`
- `GET /records`
- `GET /records/:id`
- `POST /records/upsert`
- `DELETE /records/:id`
- `GET /audit`
- `POST /audit`
- `GET /health`

The backend stores full record payloads in D1 while also keeping key columns for search/indexing. It also stores audit events and login-throttle counters.

## Security Model

Implemented in the prototype:

- Passwords are PBKDF2-hashed with random salts.
- Tokens are HMAC-signed bearer tokens.
- `TOKEN_SECRET` is required for authenticated routes.
- Failed login attempts are throttled per login/IP pair and per IP hash.
- Role checks are enforced both in frontend and backend.
- Planner users are server-restricted to orange project reservation changes.
- Record saves use optimistic concurrency.
- Backend rejects duplicate main component numbers.
- CORS is controlled by `ALLOWED_ORIGINS`.

For a production rollout, the recommended direction is Microsoft Entra ID / Cloudflare Access, group-based roles, Cloudflare WAF/rate limiting, environment-specific secrets, and operational backup/restore runbooks. See [Security and Access Model](docs/security.md) and [Production Readiness Roadmap](docs/production-readiness.md).

## Import and Backup

The admin import modal supports:

- Access/Excel/CSV tag lists using an `NR` column.
- JSON backups downloaded from **Backup JSON**.

The current tag-list import is intentionally narrow: it imports tag numbers and marks them as `I brug` with source `Scan/import`. It does not yet migrate old Access descriptions, PID history, project comments, or historical revision rows.

See [Import and Backup Formats](docs/import-formats.md) for exact examples and migration notes.

Example files are available in [`examples/`](examples/):

- [`examples/import-tag-list.csv`](examples/import-tag-list.csv)
- [`examples/full-access-migration-template.csv`](examples/full-access-migration-template.csv)
- [`examples/backup-example.json`](examples/backup-example.json)

## Current Project Status

This project is a serious functional prototype and product specification for the future Komponentdatabase. It demonstrates the desired workflows, role behavior, audit expectations, import direction, and number-availability logic. The next phase should treat this repository as the reference for business rules and use the production roadmap to build the long-term system.
