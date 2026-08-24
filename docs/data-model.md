# Production Data Model Proposal

This document proposes a production-oriented data model for the Komponentdatabase. It is not the current D1 schema. It is a target model that developers can use when designing the next version.

The prototype stores a full record JSON payload because that was the fastest way to prove the workflow. Production should keep the business behavior, but store the important entities in structured tables.

## Business Concepts

The system manages:

- one main component number
- one or more PID references
- setup numbers from `01-99`, `101-199`, ..., `901-999`
- current status per setup number
- historical status changes
- project reservations
- released numbers
- import/migration source data
- audit history

## Status Rules

| UI status | Internal status | Blocks reuse | Meaning |
| --- | --- | --- | --- |
| Blank | `available` | No | Number is free |
| I brug | `in_use` | Yes | Existing active number |
| Projekt | `reserved` | Yes | Temporarily reserved for a project |
| Frigivet | `released` | No | Historical/released number |

`Scan/import` should be stored as a source, not a status.

## Recommended Tables

### `component_records`

One row per main component number.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text/uuid | primary key |
| `main_number` | text | display value |
| `main_number_normalized` | text | unique, used for duplicate protection |
| `description` | text | current description |
| `plant` | text | current plant/process area |
| `signature_initials` | text | latest responsible initials |
| `signature_date` | date | latest signature/date |
| `created_at` | datetime | server timestamp |
| `created_by` | text | user identity |
| `updated_at` | datetime | server timestamp |
| `updated_by` | text | user identity |
| `version` | integer | optimistic concurrency |

Important index:

```sql
CREATE UNIQUE INDEX idx_component_records_main_normalized
ON component_records(main_number_normalized);
```

### `pid_references`

One row per PID linked to a main component number.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text/uuid | primary key |
| `record_id` | text | FK to `component_records` |
| `pid_number` | text | e.g. `1756` |
| `display_order` | integer | stable UI order |
| `created_at` | datetime | server timestamp |
| `created_by` | text | user identity |

This replaces parsing semicolon-separated PID values as the long-term source of truth. The UI may still accept semicolon input and convert it into rows.

### `setup_numbers`

One row per setup number that has ever been touched.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text/uuid | primary key |
| `record_id` | text | FK to `component_records` |
| `code` | text | `34`, `210`, `901`, etc. |
| `series` | integer | `0` through `9` |
| `suffix` | integer | `1` through `99` |
| `current_status` | text | `available`, `in_use`, `reserved`, `released` |
| `current_source` | text | `manual`, `scan`, `access`, `excel`, `csv`, `migration` |
| `pid_reference_id` | text/null | FK to `pid_references` |
| `updated_at` | datetime | server timestamp |
| `updated_by` | text | user identity |

Suggested constraints:

```sql
UNIQUE(record_id, code)
CHECK(series BETWEEN 0 AND 9)
CHECK(suffix BETWEEN 1 AND 99)
CHECK(current_status IN ('available','in_use','reserved','released'))
```

### `status_events`

Append-only event history for every status change.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text/uuid | primary key |
| `record_id` | text | FK to `component_records` |
| `setup_number_id` | text | FK to `setup_numbers` |
| `code` | text | duplicated for readable audit |
| `from_status` | text/null | old status |
| `to_status` | text | new status |
| `source` | text | `manual`, `autosave`, `import`, `scan`, `migration` |
| `description` | text | user/system revision text |
| `project_ref` | text/null | optional project number/comment |
| `created_at` | datetime | server timestamp |
| `created_by` | text | user identity |

The current revision log can be generated from this table.

### `project_reservations`

Optional table if project reservations need richer metadata.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text/uuid | primary key |
| `setup_number_id` | text | FK to `setup_numbers` |
| `project_ref` | text | project number/name |
| `reserved_at` | datetime | server timestamp |
| `reserved_by` | text | planner/admin |
| `released_at` | datetime/null | when reservation was removed/converted |
| `released_by` | text/null | user identity |
| `notes` | text/null | optional |

This is useful if project reservations need workflow states later.

### `import_batches`

One row per import/migration run.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text/uuid | primary key |
| `type` | text | `tag_list`, `json_backup`, `access_migration`, `scan` |
| `filename` | text | original filename |
| `source_system` | text | Access/Excel/CSV/Paper |
| `created_at` | datetime | server timestamp |
| `created_by` | text | admin user |
| `summary_json` | text/json | counts, warnings, errors |

### `import_rows`

Optional detail rows for migration traceability.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text/uuid | primary key |
| `batch_id` | text | FK to `import_batches` |
| `source_row_number` | integer | original row |
| `raw_json` | text/json | raw imported values |
| `status` | text | `imported`, `skipped`, `error` |
| `message` | text | validation message |
| `record_id` | text/null | linked record |
| `setup_number_id` | text/null | linked setup number |

### `audit_events`

System-level audit, broader than status history.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text/uuid | primary key |
| `at` | datetime | server timestamp |
| `actor` | text | initials/email |
| `role` | text | role at time of action |
| `action` | text | `login`, `save`, `delete`, `import`, etc. |
| `record_id` | text/null | optional |
| `main_number` | text/null | readable |
| `details_json` | text/json | structured details |
| `request_id` | text/null | trace/debug |

## Availability Query Rules

A number is unavailable if its current status is:

- `in_use`
- `reserved`

A number is available if:

- no row exists for the code
- or current status is `available`
- or current status is `released`

The matrix/suffix logic can then query `setup_numbers` by `main_number_normalized`, `series`, `suffix`, and `current_status`.

## Migration From Current Prototype

Current record JSON can be converted like this:

| Prototype field | Production table |
| --- | --- |
| `hovedkomponentnr` | `component_records.main_number` |
| normalized `hovedkomponentnr` | `component_records.main_number_normalized` |
| `beskrivelse` | `component_records.description` |
| `anlaeg` | `component_records.plant` |
| `pid` | `pid_references` rows |
| `selectedCodes[]` | `setup_numbers` rows |
| `codeMeta[code].mark` | `setup_numbers.current_status` |
| `codeMeta[code].source` | `setup_numbers.current_source` |
| `revisions[]` | `status_events` and/or `audit_events` |
| `audit[]` | `audit_events` |

## API Shape For Production

Recommended high-level endpoints:

```text
GET    /records
GET    /records/:id
POST   /records
PATCH  /records/:id/master-data
PATCH  /records/:id/setup-numbers/:code/status
GET    /records/:id/history
POST   /imports/tag-list
POST   /imports/access-migration/dry-run
POST   /imports/access-migration/commit
GET    /audit
GET    /admin/users-or-roles
```

The most important difference from the prototype is that a status change can become a small targeted API request instead of saving the whole record JSON every time.

## Why This Model Helps

This structure gives developers:

- better duplicate protection
- easier status history
- better import validation
- easier reporting
- safer concurrency
- less risk when changing one number
- clearer migration from Access

The existing prototype should remain the visual/business reference while this data model becomes the production target.
