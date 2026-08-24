# Review Notes

This document summarizes the current review status of the Komponentdatabase prototype. It focuses only on the current handover state and the next production phase.

## Current Status

The prototype is in a good handover state for demonstrating the desired product behavior:

- cloud-backed login and roles
- role-filtered UI actions
- server-side permission checks
- searchable component records
- `I brug`, `Projekt`, `Frigivet`, and `Scan/import` behavior
- autosave and revision logging for status changes
- duplicate main-number protection
- optimistic concurrency on saves
- JSON backup download/import
- Access/Excel/CSV tag-list import
- admin user list/create UI
- sidebar print/PDF and Excel export
- documentation for architecture, deployment, import, security, and production readiness

## Verification Performed

Recent checks include:

- JavaScript syntax validation for frontend, backend Worker, and local server
- whitespace/diff validation
- HTML ID/reference review
- Playwright UI smoke tests locally and on GitHub Pages
- targeted logout-flow test locally and on GitHub Pages
- manual review of login, role permissions, autosave, revision logging, import, backup, and backend validation paths

## Current Prototype Boundaries

The following are not "bugs"; they are the expected boundaries between this prototype and a finished production system:

| Area | Current prototype | Production direction |
| --- | --- | --- |
| Authentication | Local app login stored in D1 | Microsoft Entra ID through Cloudflare Access |
| Roles | App roles in D1 | Entra groups/app roles mapped to app roles |
| Data model | record JSON plus indexed columns | normalized records, PID references, setup numbers, status events |
| Import | narrow `NR` tag-list and JSON backup | full Access migration with dry-run validation |
| Backup | local JSON backup from UI | scheduled server/database backup and tested restore |
| Scan | heuristic checkbox detection | reviewed import workflow or dedicated document processing |
| Tests | smoke tests and manual review | unit, API, migration, and end-to-end CI tests |
| Deployment | manual GitHub/Cloudflare deploy | environment-based CI/CD with approval gates |

## Recommended Next Documents

Read these in order for the next production phase:

1. [Production Readiness Roadmap](production-readiness.md)
2. [Security and Access Model](security.md)
3. [Production Data Model Proposal](data-model.md)
4. [Import and Backup Formats](import-formats.md)
5. [Deployment Guide](deployment.md)
6. [Architecture Guide](architecture.md)

## Recommended Next Engineering Work

1. Decide the production authentication path: Cloudflare Access + Microsoft Entra ID is the preferred route.
2. Define `dev`, `test`, and `prod` Cloudflare environments with separate D1 databases and secrets.
3. Add a normalized database schema for main numbers, PID references, setup numbers, and status history.
4. Build an Access migration dry-run that validates data before anything is written.
5. Add API/unit tests for status transitions, planner restrictions, duplicate numbers, imports, and conflicts.
6. Add a deployment pipeline that runs tests before publishing frontend or Worker changes.
7. Keep the current UI as the business-reference prototype while the production implementation is designed.
