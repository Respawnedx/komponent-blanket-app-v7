# Review Notes and Known Gaps

This document records the latest project review: what was checked, what was fixed, and what remains as prototype debt.

## Review Scope

Reviewed areas:

- Static frontend markup in `index.html`.
- UI styling and responsive/print layout in `styles.css`.
- Frontend application logic in `app.js`.
- Local static server in `server.js`.
- Cloudflare Worker API in `backend/src/index.js`.
- D1 migrations.
- Backend setup documentation.
- Import/backup documentation.
- GitHub Pages and Cloudflare deployment flow.

## Checks Performed

Mechanical checks:

- Verified there are no duplicate HTML IDs.
- Checked JavaScript `getElementById()` / `el()` references against actual HTML IDs.
- Ran JavaScript syntax checks:
  - `node --check app.js`
  - `node --check backend/src/index.js`
  - `node --check server.js`
- Ran `git diff --check`.
- Ran Playwright smoke tests locally and against the live GitHub Pages URL.

Manual review:

- Login and role flow.
- Topbar visibility by role.
- Sidebar search and selected-record actions.
- Status flow: `I brug`, `Projekt`, `Frigivet`, blank.
- Autosave/revision behavior.
- JSON backup behavior.
- Access/Excel/CSV import path.
- Scan/import behavior.
- Worker authentication, throttling, permissions, CORS, and record saves.

## Issues Fixed

### Removed Dead Frontend References

Old JavaScript references pointed to buttons that no longer exist in `index.html`:

- `btnNew`
- `btnPrint`
- `btnExportExcel`
- `btnImportExcelTags`

These were harmless no-ops, but they made the code harder to reason about and showed up in automated ID checks.

### Removed Old Active-Record Excel Export Entry

The UI no longer exposes a topbar action for exporting only the active record. The active export function was removed, while selected-record Excel export remains.

Current intended workflow:

- Select records in the sidebar.
- Click **Eksportér Excel** in the sidebar tools.

### Removed Obsolete `README.txt`

`README.txt` described an old local-only mini-login prototype and referenced `ADMIN_PASSWORD`, which no longer exists. It conflicted with the current Cloudflare/user-role model and was removed.

### Updated Local Server Documentation Paths

`server.js` no longer serves the removed `README.txt`. It now serves:

- `README.md`
- files under `docs/`

### Fixed OCR/Scan Save Behavior

Previously, scan/import on an existing record called `upsertRecord()` without `await` and without adding a normal revision entry.

Now scan/import:

- awaits the save
- creates a `Scan/import fra papir` revision
- writes local record audit information
- writes backend audit information in cloud mode
- updates `loadedRecordUpdatedAt`
- clears local draft only after a successful save

### Hardened Worker Token Handling

The Worker now requires `TOKEN_SECRET` for authenticated routes. If it is missing, the Worker returns HTTP 500 instead of accidentally signing/verifying tokens with an unsafe fallback.

### Hardened Comparisons

Password hash and token-signature comparisons now use a constant-time comparison helper to reduce timing-leak risk.

### Tightened CORS Default

The Worker no longer reflects arbitrary browser origins when `ALLOWED_ORIGINS` is empty. Browser access should be explicitly allowed through `backend/wrangler.toml`.

### Added Backend Duplicate Main-Number Check

The frontend already checks for duplicate main component numbers, but the Worker now also rejects saving a record if another record has the same normalized main number.

This prevents two users or browser tabs from bypassing the UI-level duplicate protection.

### Improved Documentation

Added:

- `docs/architecture.md`
- `docs/deployment.md`
- `docs/import-formats.md`
- `docs/review-notes.md`

Updated:

- `README.md`
- `backend/README.md`

## Current Known Gaps

These are not bugs in the current prototype, but they matter before a production rewrite.

### `app.js` Is Too Large

`app.js` currently contains nearly all frontend concerns. It should eventually be split into modules:

```text
src/
├── api.js
├── auth.js
├── records.js
├── permissions.js
├── revisions.js
├── availability.js
├── import-export.js
├── scan.js
├── print.js
└── ui/
```

This would make testing and onboarding much easier.

### Data Model Is Still Prototype-Oriented

Records are stored as one JSON payload plus a few indexed columns. This is flexible, but a production database should likely normalize:

- records
- setup numbers
- per-number status history
- PID references
- projects/reservations
- revision events

The JSON payload is fine for the prototype, but it is not ideal as the only long-term source of truth.

### Access Migration Is Not Complete Yet

Current import supports a narrow `NR` tag-list format. It does not migrate:

- old descriptions
- plant values
- PID relations
- old project comments
- old revision history
- old status distinctions beyond "currently used"

See `docs/import-formats.md` for the recommended next migration format.

### Login Is Still Prototype-Level

The Worker has hashed passwords, tokens, and throttling. For a real enterprise system, the preferred solution should be:

- Microsoft Entra ID / SSO
- group-based roles
- centralized account lifecycle
- real password reset or no local passwords at all

### Password Reset Is a Mail Link

The UI currently opens an email to the administrator. A production reset flow should use:

- one-time reset tokens
- token expiry
- email delivery through an approved provider
- audit logging

### Cloudflare WAF Is Not Stored in This Repo

The Worker has application-level throttling, but Cloudflare dashboard WAF/rate-limit rules are external account configuration. Production should add a rule for:

```text
http.request.uri.path eq "/auth/login" and http.request.method eq "POST"
```

### Scan/OCR Is Heuristic

The scan feature detects checkbox marks from image darkness. It is useful for demonstration, but it is not a robust OCR pipeline.

Before production:

- test with real scans
- define accepted scan quality
- show a confirmation/review screen before saving
- consider using a dedicated document-processing flow

### Testing Is Smoke-Level

The current Playwright test catches major UI regressions, but there are no unit tests for:

- status transition logic
- planner restrictions
- availability calculations
- import parsing
- revision diffing
- Worker permission logic

These should be added before a production rebuild.

### D1 Duplicate Check Is Application-Level

The Worker checks for duplicate normalized main numbers, but D1 does not yet have a normalized unique column. If the system grows, add a `hovedkomponentnr_normalized` column and a unique index.

## Suggested Next Development Steps

1. Add automated unit tests for status and revision logic.
2. Add Worker tests for auth, planner restrictions, duplicate main numbers, and conflict saves.
3. Replace native print-copy prompt with a small modal.
4. Split `app.js` into modules.
5. Design a full Access migration schema and importer.
6. Add a normalized main-number column in D1.
7. Add production auth design with Microsoft Entra ID.
8. Add Cloudflare WAF/rate limiting.
9. Add a real CI/CD pipeline for GitHub Pages and Worker deployment.
