# Komponent Blanket App

A browser-based component form for marking component setup numbers, saving records, exporting Excel/JSON files, printing filled forms, and optionally sharing records through a Cloudflare Workers + D1 backend.

The user interface is written in plain HTML, CSS, and JavaScript. It can run as a static site, or it can connect to the Worker API configured in `index.html`.

## Project Structure

```text
.
├── index.html
├── styles.css
├── app.js
├── server.js
├── data/records.json
├── assets/afi-logo.png
└── backend/
    ├── src/index.js
    ├── migrations/001_init.sql
    ├── wrangler.toml
    ├── bootstrap-admin.js
    └── README.md
```

## How the App Works

`index.html` defines the component form, record sidebar, revision panel, login modal, revision modal, import inputs, and the `window.COMPONENT_APP_API` setting.

`app.js` owns the application state:

- `activeId` tracks the currently loaded record.
- `codeSource` stores whether each selected setup code came from manual input or scan import.
- `codeMeta` stores metadata per selected code, including mark color, user initials, timestamp, PID, and source.
- `selectedRecordIds` stores sidebar multi-selection for bulk Excel export and printing.
- `changeBuffer` temporarily tracks unsaved checkbox and metadata changes before a revision is saved.

On startup, `app.js` checks `window.COMPONENT_APP_API`.

- If it is set, the app runs in cloud mode and sends authenticated requests to the Worker API.
- If it is empty, the app runs in local mode and stores records in browser `localStorage`.

## Component Code Selection

The form shows setup codes in ranges such as `01-29`, `30-39`, and so on. The series selector changes the visible code range from `0xx` through `9xx`.

Internally, the app stores codes as strings:

- `01` through `99` for the `0xx` series.
- `101` through `999` for the other series.

When a checkbox is selected, the app records who changed it, when it changed, what mark color was used, and which PID was active if multiple PID numbers are present.

## Records and Revisions

Saving a record collects the current form fields and selected setup codes into one JSON object. Before saving, the user is asked for a short revision description. The app compares the previous saved version with the new version and writes a readable revision summary showing added, removed, and changed tags.

## Import, Export, and Print

The app supports:

- JSON import/export for backup and transfer.
- Excel export for the active record.
- Excel export for selected sidebar records.
- Excel tag import from `.xls` or `.xlsx`.
- Browser print/PDF for the active form or selected records.
- OCR/image scan import for detecting marked checkboxes from a scanned form.

Excel support is loaded from the SheetJS CDN in `index.html`.

## Running Locally

Open `index.html` directly or serve the folder with a simple local web server. In this mode, records are stored in browser `localStorage`.

The included local server has no npm dependencies:

```bash
node server.js
```

Then open:

```text
http://localhost:3000
```

The server serves the static frontend and exposes:

- `GET /api/records`
- `POST /api/records`

The current frontend does not automatically use these local `/api/records` endpoints; they are kept as a simple extension point for file-based storage.

## Cloud Mode

The frontend connects to Cloudflare by setting this value in `index.html`:

```html
<script>
  window.COMPONENT_APP_API = "https://your-worker-url.workers.dev";
</script>
```

When this value is not empty, users must log in with initials and a PIN. Records are stored in D1 and shared across users.

The app uses three access levels:

- `user`: can log in, search, view records, print, and export visible data.
- `allocator`: semi-admin access; can reserve/take component numbers, edit records, save revisions, import records, run OCR, and delete records.
- `admin`: full access; includes allocator permissions plus user management.

See [backend/README.md](backend/README.md) for Worker deployment, D1 setup, secrets, migrations, and admin bootstrap instructions.

## Backend Overview

The Worker in `backend/src/index.js` provides:

- `POST /auth/login` for initials + PIN authentication.
- `GET /auth/me` for checking the current token.
- `GET /admin/users` and `POST /admin/users` for admin-only user management.
- `GET /records`, `GET /records/:id`, `POST /records/upsert`, and `DELETE /records/:id` for shared records.
- `GET /audit` and `POST /audit` for audit history.
- `GET /health` for a simple health check.

PINs are stored as PBKDF2 hashes with a random salt. Login returns a signed bearer token. Each authenticated request verifies the token and checks that the user still exists and is not disabled.

Read-only record routes require any valid user. Record-changing routes require `allocator` or `admin`.

## Important Configuration

`backend/wrangler.toml` contains:

- Worker name and entry point.
- D1 database binding.
- `ALLOWED_ORIGINS` for CORS.
- `TOKEN_TTL_SECONDS` for login token lifetime.

Set `TOKEN_SECRET` as a Cloudflare Worker secret:

```bash
wrangler secret put TOKEN_SECRET
```

Use a long random value.

## Development Notes

- The frontend is deliberately dependency-light and uses browser APIs directly.
- `app.js` is currently large because it contains state management, UI rendering, import/export, printing, auth, and API integration in one file. A future cleanup could split it into modules such as `records.js`, `api.js`, `export.js`, and `ui.js`.
- The Worker CORS allowlist should include every production frontend origin that needs cloud access.
- When testing the cloud-connected frontend through `node server.js`, include `http://localhost:3000` and `http://127.0.0.1:3000` in `ALLOWED_ORIGINS`.
- The app uses Danish UI text because it is built for the component-blanket workflow, while this documentation is written in English for maintainability.
