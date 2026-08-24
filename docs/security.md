# Security and Access Model

This document describes the recommended security model for turning the Komponentdatabase prototype into a production-ready internal application.

## Security Goals

The system should protect:

- component numbering data
- project reservations
- historical release/audit information
- import and migration data
- user identities and permissions

The most important practical risks are:

- unauthorized edits
- brute-force login attempts
- two users overwriting each other
- accidental data loss during import
- unclear audit history
- stale test/demo credentials being used in production

## Recommended Production Login Model

Use enterprise identity instead of local app passwords.

Recommended path:

```text
Microsoft Entra ID
  -> Cloudflare Access
  -> Komponentdatabase frontend/API
```

Benefits:

- users log in with their normal company identity
- MFA and conditional access can be handled centrally
- user offboarding is handled by Entra
- roles can be assigned through groups or app roles
- the application avoids owning password reset flows

The current initials/password login can remain for local development and demos, but production should be protected by Entra/Cloudflare Access.

## Role Model

Application roles:

| Role | UI label | Production assignment | Access |
| --- | --- | --- | --- |
| `user` | `VIEW` | `Komponentdatabase-View` | Search, view, print/export selected records |
| `allocator` | `PLAN` | `Komponentdatabase-Plan` | Reserve/remove orange project numbers and create project-only records |
| `admin` | `ADMIN` | `Komponentdatabase-Admin` | Full data maintenance, imports, backup, users, delete |

The Worker/API must continue to enforce roles server-side. Frontend button visibility is only usability, not security.

## Production Access Flow

Target flow:

1. User opens the app URL.
2. Cloudflare Access requires login through Microsoft Entra ID.
3. Access policy allows only approved groups/app roles.
4. Worker receives trusted identity context from Cloudflare Access.
5. Worker maps identity to `user`, `allocator`, or `admin`.
6. Every write request is validated again by the Worker.

If local app tokens are still used behind Access, they should be short-lived and environment-specific.

## Password Reset

Current prototype behavior:

- the UI opens a mail link to an administrator

Production recommendation:

- avoid local passwords by using Entra/Access
- if local passwords remain, implement one-time reset tokens
- reset tokens must expire
- reset events must be audited
- email must be sent through an approved provider

Do not use the current mail link as a production password-reset mechanism.

## Brute Force And DDoS Protection

Current Worker protection:

- failed login throttling per login/IP pair
- failed login throttling per IP hash
- throttled requests return `429 Too Many Requests`

Production should add outer protection in Cloudflare:

- WAF/rate limiting for `POST /auth/login`
- optional rate limits for write-heavy API routes
- Cloudflare Access policy in front of the app

Recommended WAF expression for local-password login endpoints:

```text
(http.request.uri.path eq "/auth/login" and http.request.method eq "POST")
```

If Cloudflare Access replaces app passwords, `/auth/login` may become development-only or be removed from production.

## CORS

Keep `ALLOWED_ORIGINS` explicit per environment.

Good:

```text
https://prod.example.com
https://test.example.com
http://localhost:5500
```

Bad:

```text
*
```

Only development origins should be allowed in development/test. Production should not allow arbitrary localhost origins.

## Secrets

Each environment needs separate secrets:

- `TOKEN_SECRET`
- any future Access/Entra verification secret
- any email provider/API secret

Rules:

- never commit secrets to Git
- rotate secrets when a developer leaves or a secret is exposed
- use long random values
- document where the secret is set, not the value

## Audit Requirements

Production audit should record:

- login success/failure if app login exists
- user identity from Entra/Access
- record create/update/delete
- every status transition
- every project reservation/removal
- every release/unrelease action
- imports
- backup/restore operations
- admin user/role changes
- failed permission checks

Audit rows should include:

- timestamp
- actor
- role
- action
- record ID / main number if relevant
- affected tag numbers if relevant
- old value
- new value
- source (`manual`, `autosave`, `import`, `scan`, `migration`)
- request ID if available

## Concurrency And Data Integrity

Security also includes protecting against accidental overwrite.

Production requirements:

- optimistic concurrency on every record save
- server-side duplicate main-number protection
- normalized unique index for main component numbers
- frontend conflict dialog
- no silent overwrite on stale data

## Admin Safety

High-risk admin actions should have stronger confirmation:

- import data
- restore backup
- delete record
- mass status update
- user role change

The UI should show what will change before committing the action.

## Production Checklist

Before real production use:

- [ ] Cloudflare Access protects the frontend and API.
- [ ] Microsoft Entra ID is configured as identity provider.
- [ ] Roles are mapped to groups/app roles.
- [ ] Demo users/passwords are removed from production.
- [ ] WAF/rate limits are configured.
- [ ] `ALLOWED_ORIGINS` only contains approved origins.
- [ ] Secrets are unique per environment.
- [ ] Backup and restore are tested.
- [ ] Audit logs are reviewed and retained.
- [ ] CI tests block unsafe deployment.

## Official References

- Cloudflare: [Microsoft Entra ID identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/entra-id/)
- Microsoft: [Configure Cloudflare with Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/cloudflare-integration)
- Microsoft: [App roles in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps)
- Microsoft: [Assign users and groups to an enterprise application](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal)
- Cloudflare: [WAF rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
