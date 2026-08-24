# Backend: Cloudflare Workers + D1

This backend stores shared component records, handles initials/email + password login, manages users, and writes audit events.

## Access Levels

- `user`: read-only access for searching, viewing, printing, and exporting existing records.
- `allocator`: planner access. It can add or remove orange project reservations and can create new records only when they contain orange project reservations. It cannot edit master data on existing records, import, OCR, delete, or change blue/red statuses.
- `admin`: full access, including user management, imports, OCR/scan, record creation, status changes, JSON backup, and deletes.

## Requirements

- Node.js
- A Cloudflare account
- Wrangler CLI

Install and log in:

```bash
npm i -g wrangler
wrangler login
```

## Create the D1 Database

From the `backend` folder:

```bash
wrangler d1 create komponent_db
```

Copy the generated `database_id` into `wrangler.toml` under `[[d1_databases]]`.

## Apply Migrations

```bash
wrangler d1 migrations apply komponent_db --remote
```

This creates:

- `users` for login, email lookup, and roles.
- `records` for saved component forms.
- `audit` for user actions and record changes.
- `login_throttle` for failed-login throttling.

## Configure Secrets and Variables

Set the token signing secret:

```bash
wrangler secret put TOKEN_SECRET
```

Use a long random value.

`wrangler.toml` also contains:

- `ALLOWED_ORIGINS`: comma-separated frontend origins allowed by CORS.
- `TOKEN_TTL_SECONDS`: bearer token lifetime in seconds.

Example:

```toml
[vars]
ALLOWED_ORIGINS = "https://respawnedx.github.io,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500"
TOKEN_TTL_SECONDS = "604800"
```

## Deploy

```bash
wrangler deploy
```

After deployment, set the frontend API URL in the root `index.html`:

```html
<script>
  window.COMPONENT_APP_API = "https://your-worker-url.workers.dev";
</script>
```

## Create the First Admin User

The app requires an admin user before more users can be created from the UI.

Use the bootstrap helper:

```bash
node bootstrap-admin.js AB 5678 ab@arlafoods.com
```

The script prints SQL that inserts an admin user with a hashed password. Run that SQL in the Cloudflare D1 console or with `wrangler d1 execute`.

After that, log in as the admin user in the app and use **Brugere** to create or update users.

## API Routes

### Health

- `GET /health`

Returns `{ ok: true, ts }`.

### Authentication

- `POST /auth/login`
- `GET /auth/me`

Login accepts:

```json
{
  "login": "ab@arlafoods.com",
  "password": "5678"
}
```

It also accepts `"initials": "AB"` for the same endpoint and still accepts the legacy `"pin"` property for prototype/demo users. The response returns a bearer token plus the user initials, email, and role.

Failed logins are throttled in D1:

- Per login/IP combination: 8 failed attempts in 15 minutes triggers a temporary lockout.
- Per IP hash: 30 failed attempts in 15 minutes triggers a temporary lockout.
- Lockouts return `429 Too Many Requests` with `Retry-After`.
- Successful login clears the counters for that login/IP pair.

This is application-level brute-force protection. For production, also add a Cloudflare WAF rate limiting rule for `POST /auth/login`, for example with the expression:

```text
(http.request.uri.path eq "/auth/login" and http.request.method eq "POST")
```

Cloudflare WAF/Rate Limiting should be the outer layer for request floods and credential stuffing. The Worker throttling is the inner layer that still protects the API if traffic reaches the Worker.

### Admin Users

- `GET /admin/users`
- `POST /admin/users`

These routes require an authenticated admin token.

Create or update a user:

```json
{
  "initials": "AB",
  "email": "ab@arlafoods.com",
  "password": "5678",
  "role": "allocator"
}
```

Passwords must be 4-64 characters. The legacy `pin` property is also accepted. Accepted roles are `user`, `allocator`, `planner`, and `admin`. The aliases `planner`, `semi-admin`, `semi_admin`, and `editor` are normalized to `allocator`.

### Records

- `GET /records`
- `GET /records/:id`
- `POST /records/upsert`
- `DELETE /records/:id`

Records are stored as structured columns for indexing plus the full JSON payload used by the frontend.

`POST /records/upsert` sets server-authoritative `editedBy` and `updatedAt` values before storing the record.

`GET /records` and `GET /records/:id` require any valid logged-in user. `POST /records/upsert` requires `allocator` or `admin`; the server verifies that `allocator` users only change orange project reservations. New allocator-created records must contain at least one orange project reservation. `DELETE /records/:id` requires `admin`.

### Audit

- `GET /audit`
- `GET /audit?record_id=<id>`
- `POST /audit`

Audit rows track logins, saves, deletes, admin actions, and frontend-supplied events.

Writing audit rows through `POST /audit` requires `allocator` or `admin`.

## Security Notes

- Passwords are hashed with PBKDF2 and a random salt.
- Tokens are signed with `TOKEN_SECRET`.
- Every protected route verifies the token and checks that the user still exists and is not disabled.
- Failed login throttling uses hashed login/IP keys so raw IP addresses are not stored in the throttle table.
- CORS is controlled by `ALLOWED_ORIGINS`; add local development origins there when testing.
- The current password reset UI is a prototype mail link to an administrator. A production reset flow should use one-time tokens and an approved email provider.
