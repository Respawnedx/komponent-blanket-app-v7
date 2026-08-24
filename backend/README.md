# Backend: Cloudflare Workers + D1

This backend stores shared component records, handles initials/email + PIN login, manages users, and writes audit events.

## Access Levels

- `user`: read-only access for searching, viewing, printing, and exporting existing records.
- `allocator`: planner access. It can only add or remove orange project reservations on existing records. It cannot create records, edit master data, import, OCR, delete, or change blue/red statuses.
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

The script prints SQL that inserts an admin user with a hashed PIN. Run that SQL in the Cloudflare D1 console or with `wrangler d1 execute`.

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
  "pin": "5678"
}
```

It also accepts `"initials": "AB"` for the same endpoint. The response returns a bearer token plus the user initials, email, and role.

### Admin Users

- `GET /admin/users`
- `POST /admin/users`

These routes require an authenticated admin token.

Create or update a user:

```json
{
  "initials": "AB",
  "email": "ab@arlafoods.com",
  "pin": "5678",
  "role": "allocator"
}
```

PINs must be 4-8 digits. Accepted roles are `user`, `allocator`, `planner`, and `admin`. The aliases `planner`, `semi-admin`, `semi_admin`, and `editor` are normalized to `allocator`.

### Records

- `GET /records`
- `GET /records/:id`
- `POST /records/upsert`
- `DELETE /records/:id`

Records are stored as structured columns for indexing plus the full JSON payload used by the frontend.

`POST /records/upsert` sets server-authoritative `editedBy` and `updatedAt` values before storing the record.

`GET /records` and `GET /records/:id` require any valid logged-in user. `POST /records/upsert` requires `allocator` or `admin`; the server verifies that `allocator` users only change orange project reservations on existing records. `DELETE /records/:id` requires `admin`.

### Audit

- `GET /audit`
- `GET /audit?record_id=<id>`
- `POST /audit`

Audit rows track logins, saves, deletes, admin actions, and frontend-supplied events.

Writing audit rows through `POST /audit` requires `allocator` or `admin`.

## Security Notes

- PINs are hashed with PBKDF2 and a random salt.
- Tokens are signed with `TOKEN_SECRET`.
- Every protected route verifies the token and checks that the user still exists and is not disabled.
- CORS is controlled by `ALLOWED_ORIGINS`; add local development origins there when testing.
- The current password reset UI is a prototype mail link to an administrator. A production reset flow should use one-time tokens and an approved email provider.
