# Backend: Cloudflare Workers + D1

This backend stores shared component-blanket records, handles initials + PIN login, manages users, and writes audit events.

## Access Levels

- `user`: read-only access for searching, viewing, printing, and exporting existing records.
- `allocator`: semi-admin access for reserving/taking component numbers, editing records, importing, OCR changes, and deleting records.
- `admin`: full access, including creating and updating users.

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

- `users` for login and roles.
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
node bootstrap-admin.js AB 5678
```

The script prints SQL that inserts an admin user with a hashed PIN. Run that SQL in the Cloudflare D1 console or with `wrangler d1 execute`.

After that, log in as the admin user in the app and use **Admin: Opret bruger** to create or update users.

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
  "initials": "AB",
  "pin": "5678"
}
```

It returns a bearer token plus the user initials and role.

### Admin Users

- `GET /admin/users`
- `POST /admin/users`

These routes require an authenticated admin token.

Create or update a user:

```json
{
  "initials": "AB",
  "pin": "5678",
  "role": "allocator"
}
```

PINs must be 4-8 digits. Accepted roles are `user`, `allocator`, and `admin`. The aliases `semi-admin`, `semi_admin`, and `editor` are normalized to `allocator`.

### Records

- `GET /records`
- `GET /records/:id`
- `POST /records/upsert`
- `DELETE /records/:id`

Records are stored as structured columns for indexing plus the full JSON payload used by the frontend.

`POST /records/upsert` sets server-authoritative `editedBy` and `updatedAt` values before storing the record.

`GET /records` and `GET /records/:id` require any valid logged-in user. `POST /records/upsert` and `DELETE /records/:id` require `allocator` or `admin`.

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
