# Production Readiness Roadmap

This document describes how the Komponentdatabase prototype should be prepared for a real production environment. It is written as a handover plan for the developers who will turn the prototype into a maintainable internal system.

The current prototype is useful because it proves the business workflow:

- search component numbers
- prevent duplicate numbering
- reserve temporary project numbers
- release old numbers without blocking future availability
- log all important changes
- import old Access/Excel/CSV tag lists
- keep a JSON backup format for prototype recovery

Production work should preserve those rules, but move the technical foundation toward enterprise authentication, stricter data modeling, automated deployment, and operational runbooks.

## Target Production Architecture

Recommended target:

```text
User browser
  |
  | Microsoft Entra ID login through Cloudflare Access
  v
Cloudflare protected frontend
  |
  | HTTPS API requests with identity context
  v
Cloudflare Worker API
  |
  | D1 / future SQL database
  v
Production data model
  records
  component_numbers
  pid_references
  number_status_events
  project_reservations
  audit_events
  users_or_role_cache
```

The existing static frontend and Worker are fine for the prototype. For production, the main decision is whether the final frontend remains static or is rebuilt with a typed application framework. Either way, the Worker/API should remain the authority for permissions, validation, audit, and concurrency.

## Environments

Use three separate environments:

| Environment | Purpose | Data |
| --- | --- | --- |
| `dev` | Developer work and experiments | fake or disposable data |
| `test` / `staging` | user acceptance testing and migration rehearsals | copied/anonymized production-like data |
| `prod` | real daily use | production data only |

Each environment should have:

- its own Worker deployment
- its own D1 database or production database
- its own secrets
- its own `ALLOWED_ORIGINS`
- its own frontend URL
- its own Cloudflare Access application/policy

Avoid pointing local or test frontends at the production database.

## Production Authentication

Preferred production direction:

1. Protect the application with Cloudflare Access.
2. Use Microsoft Entra ID as the identity provider.
3. Map Entra groups or app roles to Komponentdatabase roles.
4. Let Entra handle account lifecycle, MFA, password reset, and offboarding.

Recommended role mapping:

| Komponentdatabase role | Entra group/app role | Meaning |
| --- | --- | --- |
| `user` | `Komponentdatabase-View` | Search and view records |
| `allocator` | `Komponentdatabase-Plan` | Reserve and remove project reservations |
| `admin` | `Komponentdatabase-Admin` | Maintain data, imports, users, and system settings |

The current local password login can remain as a demo/development fallback, but it should not be the primary production access model.

## Production Data Model

The prototype stores each record as a JSON payload plus search columns. That keeps the demo flexible, but production should normalize the important business entities.

Recommended normalized entities:

- component record / main component number
- PID references
- setup numbers
- current number status
- status history
- project reservation metadata
- revision/audit events
- import batches

See [Production Data Model Proposal](data-model.md).

## Autosave and Audit

Production rule:

Every important status change must be saved and logged automatically.

That includes:

- blank -> `I brug`
- blank -> `Projekt`
- blank -> `Frigivet`
- `I brug` -> blank
- `Projekt` -> blank
- `Frigivet` -> blank
- `Projekt` -> `Frigivet`
- `Frigivet` -> `Projekt`
- PID binding changes
- master-data changes
- imports
- deletes

The UI can still have a visible **Gem ændringer** button for deliberate master-data edits, but the system should not rely on users pressing it before critical status changes are preserved.

## Concurrency

Production must protect against two users changing the same record at the same time.

Minimum:

- optimistic concurrency using an `updated_at` or version column
- clear `409 Conflict` response from the API
- user-friendly conflict dialog in the frontend
- "reload latest" and "review my changes" actions

Better:

- lightweight edit presence, for example "NJ is viewing/editing this record"
- short-lived edit leases for high-risk operations
- full event history so conflicts can be reconstructed

## Import and Migration

Keep two different import concepts:

1. **Operational import**
   Used by admins for tag lists from Access, Excel, CSV, or paper scan. This can remain additive and conservative.

2. **Full migration**
   One controlled migration from the old Access database into the production model.

A production migration should include:

- main component number
- description
- plant/process area
- one or more PID references
- setup number
- current status
- project/reservation comment if known
- source system row ID
- import batch ID
- migration timestamp
- validation report

The current `NR` tag-list import is useful, but it should not be treated as the final Access migration.

## Backup and Restore

The current **Backup JSON** button is useful for prototype safety and manual troubleshooting. Production backup should be server-side and scheduled.

Recommended backup layers:

- D1 export before large imports
- scheduled D1 exports stored outside the app
- documented restore test
- JSON backup kept only as an application-level export for support/migration
- audit log retained according to internal policy

Before any large Access import:

1. Export D1/database backup.
2. Download application JSON backup.
3. Import a small sample in `test`.
4. Validate search, availability, statuses, and audit.
5. Import full dataset in `test`.
6. Repeat in `prod` only after approval.

## Security Controls

Production controls should include:

- Microsoft Entra ID / Cloudflare Access in front of the app
- WAF/rate limit rule for login and API endpoints
- backend role checks for every write
- separate secrets per environment
- short enough token/session lifetime
- no demo credentials in production
- audit for logins, failed logins, writes, imports, deletes, and admin actions
- backup/restore runbook
- incident response contact/process

See [Security and Access Model](security.md).

## Testing and CI/CD

Production should have automated checks before deployment:

- JavaScript/TypeScript syntax and lint checks
- unit tests for status transitions
- unit tests for availability/matrix suggestions
- import parser tests
- Worker API tests for permissions and conflicts
- Playwright smoke tests for login/search/status/save/import
- migration dry-run validation tests

Recommended deployment flow:

```text
Pull request
  -> automated checks
  -> review
  -> deploy to test
  -> smoke test
  -> manual approval
  -> deploy to production
  -> smoke test
```

## Suggested Implementation Phases

### Phase 1: Harden The Existing Prototype

- Keep current UI and Worker.
- Add environment-specific config files.
- Add production WAF/rate limits.
- Add D1 export/restore runbook.
- Add more Playwright tests.
- Add backend tests around roles and conflicts.

### Phase 2: Production Data Foundation

- Add normalized database tables.
- Add unique normalized main-number constraint.
- Add event table for per-number status history.
- Add import batch table.
- Build a migration dry-run tool.

### Phase 3: Enterprise Access

- Add Cloudflare Access + Microsoft Entra ID.
- Map groups/app roles to `VIEW`, `PLAN`, and `ADMIN`.
- Remove demo users from production.
- Decide whether local passwords stay only in `dev`.

### Phase 4: Rebuild Or Modularize Frontend

- Split `app.js` into modules or rebuild with a typed frontend stack.
- Keep the current UI/business behavior as the reference.
- Add stronger form validation and conflict dialogs.
- Improve import review screens.

### Phase 5: Access Migration And Go-Live

- Export old Access data.
- Run migration into `test`.
- Review data with process owners.
- Freeze old Access writes.
- Backup production.
- Run final migration.
- Start production use.
- Keep rollback instructions available.

## Official References

- Cloudflare: [Microsoft Entra ID identity provider for Cloudflare One](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/entra-id/)
- Microsoft: [Configure Cloudflare with Microsoft Entra ID for secure hybrid access](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/cloudflare-integration)
- Microsoft: [Add app roles and get them from a token](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps)
- Microsoft: [Assign users and groups to an enterprise application](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal)
- Cloudflare: [WAF rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- Cloudflare: [D1 import and export data](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- Cloudflare: [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
