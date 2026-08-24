# Architecture Guide

This guide explains how the Komponentdatabase prototype is structured and how the main code paths work. It is written for a developer who needs to understand the existing prototype before rebuilding, extending, or replacing it.

For the recommended production direction, read:

- [Production Readiness Roadmap](production-readiness.md)
- [Security and Access Model](security.md)
- [Production Data Model Proposal](data-model.md)

## High-Level Architecture

The project has two runtime layers:

```text
Browser frontend
  index.html
  styles.css
  app.js
        |
        | HTTPS + Bearer token
        v
Cloudflare Worker
  backend/src/index.js
        |
        | D1 binding: env.DB
        v
Cloudflare D1
  users
  records
  audit
  login_throttle
```

The frontend is a static site. It can be hosted by GitHub Pages because it does not require a Node build step.

The backend is a Cloudflare Worker. It owns authentication, user administration, server-side permission checks, record storage, audit storage, duplicate protection, and optimistic concurrency.

## Runtime Modes

`app.js` reads `window.COMPONENT_APP_API` from `index.html`.

If the value is set:

- The app runs in cloud mode.
- Users must log in.
- Records are fetched from `/records`.
- Saves go through `/records/upsert`.
- Users are stored in Cloudflare D1.

If the value is empty:

- The app runs in local fallback mode.
- Records are stored in browser `localStorage`.
- This mode is useful for UI development only.

Current production-like setup uses cloud mode.

## Frontend File Responsibilities

### `index.html`

Defines the static DOM:

- Topbar and role/action groups.
- Login gate and login modal.
- Search/sidebar panel.
- Component form and checkbox ranges.
- Work-status panel.
- Revision log panel.
- Import data modal.
- Admin users modal.
- Hidden file inputs for import and scan.
- API URL configuration.

There is no frontend build step. The browser loads `styles.css`, SheetJS from CDN, then `app.js`.

### `styles.css`

Contains all visual styling:

- Login page.
- Topbar.
- Search sidebar.
- Component form.
- Checkbox grid.
- Status/availability panel.
- Revision log.
- Import/admin modals.
- Print/PDF layout.
- Responsive behavior.

The layout intentionally uses restrained operational UI styling, because this is a work tool rather than a marketing site.

### `app.js`

This is currently the main frontend application file. It contains:

- State variables.
- Role and permission helpers.
- Cloud API helpers.
- Checkbox grid construction.
- Record rendering.
- Form serialization/deserialization.
- Availability calculations.
- Autosave and draft handling.
- Revision rendering.
- Import handling.
- OCR/scan handling.
- Admin user UI handling.

Some shared logic has been split into browser modules under `src/`:

- `src/export.js`
- `src/numbering.js`
- `src/status.js`
- `src/permissions.js`
- `src/revisions.js`
- `src/scan.js`

`app.js` still owns the main UI orchestration and can be split further as the production implementation matures.

## Frontend State Model

Important state variables in `app.js`:

| Variable | Purpose |
| --- | --- |
| `activeId` | ID of the currently opened record. |
| `loadedRecordUpdatedAt` | Server timestamp from when the open record was loaded. Used for optimistic concurrency. |
| `recordsCache` | Cloud-mode cache of records returned by `/records`. |
| `codeSource` | Map of selected setup number to source: `manual` or `scan`. |
| `codeMeta` | Map of selected setup number to status/user/time/PID metadata. |
| `changeBuffer` | Fine-grained unsaved status changes used for audit/revision generation. |
| `currentMark` | Active marking status: `blue`, `reserved`, or `red`. |
| `currentSeries` | Active visible series: `0` through `9`. |
| `currentFilter` | Current status/source filter in the work-status panel. |
| `pidOptions` | Parsed PID numbers from the PID field. |
| `currentPidIdx` | Selected PID when multiple PIDs exist. |
| `selectedRecordIds` | Sidebar multi-select set for batch print/export. |

## Record Data Shape

A record is stored as one JSON payload in D1 and in the frontend cache.

Example:

```json
{
  "id": "uuid",
  "hovedkomponentnr": "1400",
  "beskrivelse": "Luftudskiller",
  "anlaeg": "Isvand 3",
  "pid": "1756;1785",
  "signatur1": "NJ",
  "signatur2": "2026-08-25",
  "selectedCodes": ["34", "210"],
  "codeSources": {
    "34": "manual",
    "210": "scan"
  },
  "codeMeta": {
    "34": {
      "by": "NJ",
      "at": "2026-08-25T10:00:00.000Z",
      "source": "manual",
      "mark": "blue",
      "pid": "1756",
      "pidIdx": 0,
      "pidColor": 0
    }
  },
  "editedBy": "NJ",
  "updatedAt": "2026-08-25T10:00:00.000Z",
  "audit": [],
  "revisions": []
}
```

The Worker also stores searchable/indexable fields as columns in the `records` table:

- `id`
- `hovedkomponentnr`
- `beskrivelse`
- `anlaeg`
- `pid`
- `signatur1`
- `signatur2`
- `selected_count`
- `created_at`
- `created_by`
- `updated_at`
- `updated_by`

The full JSON payload remains the source of truth for the form state.

## Number and Status Model

The form shows setup ranges:

- `01-29`
- `30-39`
- `40-49`
- `50-59`
- `60-69`
- `70-79`
- `80-89`
- `90-99`

The series selector transforms those ranges into:

- `0xx`: `01` through `99`
- `1xx`: `101` through `199`
- `2xx`: `201` through `299`
- and so on through `9xx`

Statuses:

| Status | Internal value | Blocks availability | Meaning |
| --- | --- | --- | --- |
| I brug | `blue` | Yes | Existing active number. |
| Projekt | `reserved` | Yes | Temporary project reservation. |
| Frigivet | `red` | No | Historical/released/renumbered number. |

`Scan/import` is not a status. It is a source marker stored in `codeSource` and `codeMeta.source`.

## Availability Logic

Availability is calculated in the browser from all loaded records.

The key functions are:

- `getBlockingCodesInOtherRecords(mainRaw, excludeId)`
- `updateAvailabilityDisplay()`
- `renderMatrixCandidates(mainRaw, usedOther)`
- `renderSuffixOverview(mainRaw, usedOther)`

Rules:

- Only records with the same normalized main component number are considered.
- The current open record is excluded from "other records".
- `I brug` and `Projekt` block a number.
- `Frigivet` does not block a number.
- Available ranges are compressed visually, for example `01-03` instead of `01`, `02`, `03`.
- Matrix suggestions rank suffixes by how many of the `0xx` through `9xx` positions are free.

## Save Flow

Manual save:

1. User presses **Gem ændringer**.
2. `saveCurrentRecord({ mode: "manual" })` validates the main number.
3. In cloud mode, records are fetched to check duplicates.
4. The user is asked for a revision description.
5. `getFormData()` builds the record JSON.
6. `computeTagChanges(prevRec, rec)` generates a readable revision summary.
7. The frontend sends the record to `/records/upsert`.
8. The Worker checks auth, role, duplicate main number, planner restrictions, and optimistic concurrency.
9. D1 stores the updated record.
10. The frontend refreshes UI state and clears the local draft.

Autosave:

1. User changes a status checkbox.
2. `applyCheckChange()` updates `codeSource`, `codeMeta`, and `changeBuffer`.
3. `scheduleAutoSave()` debounces the save.
4. `saveCurrentRecord({ mode: "auto" })` runs without asking for manual revision text.
5. The revision description is generated from the first tag-change line.

Master fields do not autosave directly. They are saved to a local draft and require manual **Gem ændringer**.

## Draft and Browser-Close Safety

Drafts are stored in `localStorage` under `componentFormDraft_v1`.

Draft content includes:

- current form fields
- active record ID
- loaded record timestamp
- selected status state
- PID/series/filter state
- `codeSource`
- `codeMeta`
- `changeBuffer`

The app uses `beforeunload` to show the browser's standard close/refresh warning if:

- autosave is pending
- autosave is in flight
- there are buffered changes
- there is a local draft for the current user

Modern browsers do not allow custom text in that warning.

## Revision System

Revision entries are stored inside each record:

```json
{
  "at": "2026-08-25T10:00:00.000Z",
  "by": "NJ",
  "desc": "Project 2026-123",
  "changes": "Projekt reserveret: 1400.210🟠"
}
```

`computeTagChanges(prevRec, currRec)` compares:

- added setup numbers
- removed setup numbers
- status transitions
- PID binding changes when multiple PIDs exist

The revision renderer turns tag references into visual chips for readability.

## Import and Export

### Access / Excel / CSV

The tag-list import reads the first sheet and a column named `NR`. It extracts full tags such as `1400.034` and groups them by main component number.

Imported numbers are marked:

- status: `I brug`
- source: `Scan/import`

See [Import and Backup Formats](import-formats.md).

### JSON Backup

The JSON backup export creates:

```json
{
  "schema": "komponentdatabase.backup.v2",
  "exportedAt": "...",
  "source": "cloud",
  "exportedBy": "NJ",
  "count": 10,
  "records": []
}
```

JSON import accepts both this format and older raw arrays of records.

### Excel Export

Selected sidebar records can be exported to Excel. The export creates:

- A combined `Alle` sheet.
- One sheet per selected main component number.

Text-like columns are forced to string values so Excel does not convert tags or leading-zero numbers.

### Print/PDF

Selected sidebar records can be rendered into print pages. The print code generates a temporary DOM view, opens browser print, and then restores the normal app view.

## OCR / Paper Scan Flow

The scan feature is a checkbox detector, not full OCR.

Flow:

1. Admin selects an image file.
2. The app switches to `0xx`, because scan detection maps to the original `01-99` blanket.
3. The image is scaled down if very large.
4. The canvas is auto-cropped to non-white content.
5. The crop is mapped to the current paper layout.
6. Each visible checkbox area is sampled.
7. Darker-than-background centers are treated as marked.
8. Detected codes replace current `0xx` scan selections.
9. Existing records are saved with a `Scan/import fra papir` revision.

This is useful for prototype demonstration, but it should be replaced or heavily tested before production.

## Backend Responsibilities

The Worker in `backend/src/index.js` owns:

- CORS.
- Authentication.
- Token signing and verification.
- Login throttling.
- User management.
- Role enforcement.
- Record CRUD.
- Planner mutation restrictions.
- Optimistic concurrency.
- Duplicate main-number rejection.
- Audit table writes.

## Backend Tables

### `users`

Stores login users:

- `initials`
- `email`
- `role`
- `pin_salt`
- `pin_hash`
- `disabled`
- `created_at`
- `created_by`

### `records`

Stores records:

- searchable fields
- selected count
- full JSON payload
- created/updated metadata

### `audit`

Stores backend-level audit events:

- login
- failed login
- throttled login
- saves
- deletes
- admin user actions
- frontend-supplied events

### `login_throttle`

Stores hashed failed-login counters:

- per login/IP pair
- per IP hash

Raw IP addresses are not stored in this table.

## Security Controls

Current controls:

- PBKDF2 password hashing.
- HMAC-signed bearer tokens.
- Required `TOKEN_SECRET`.
- Constant-time comparison for password hashes and token signatures.
- D1-backed login throttling.
- Role enforcement in Worker.
- Planner-specific server validation.
- Optimistic concurrency on record saves.
- Backend duplicate main-number check.
- CORS allowlist.

Recommended production additions:

- Microsoft Entra ID / SSO.
- Cloudflare WAF and rate limiting.
- Proper account lifecycle management.
- Password reset tokens if local passwords remain.
- Structured server-side logs/monitoring.
- CI security checks.

## Production Transition Notes

The prototype was intentionally kept dependency-light and static-hostable. That makes it easy to deploy and show. For production, the main transition should be:

- move authentication to Microsoft Entra ID / Cloudflare Access
- split frontend concerns into modules or a typed frontend app
- normalize records, PID references, setup numbers, and status events
- build a full Access migration with dry-run validation
- keep the current UI/business rules as the reference behavior
