# Komponent-blanket backend (Cloudflare Workers + D1)

Dette er en lille backend til **komponent-blanket-app**:

- Login med **initialer + PIN**
- Delte poster (records) for alle brugere
- Audit-log (hvem gjorde hvad, hvornår)

## 1) Forudsætninger
- Node.js
- Cloudflare account
- Wrangler CLI

Installer Wrangler og log ind:

```bash
npm i -g wrangler
wrangler login
```

## 2) Opret D1 database

```bash
cd backend
wrangler d1 create komponent_db
```

Kopiér `database_id` ind i `wrangler.toml` under `[[d1_databases]]`.

## 3) Kør migrations (opret tabeller)

```bash
wrangler d1 migrations apply komponent_db --remote
```

## 4) Sæt secrets

Du skal sætte mindst disse secrets:

```bash
wrangler secret put TOKEN_SECRET
```

Vælg en lang tilfældig streng (fx 32+ tegn).

## 5) Deploy backend

```bash
wrangler deploy
```

Du får en URL som fx:

```
https://komponent-blanket-backend.<dit-subdomain>.workers.dev
```

## 6) Opret første admin-bruger

**Du skal have mindst én admin**, før du kan oprette andre brugere via app’en.

Kør dette i terminalen (erstat URL og PIN):

```bash
curl -X POST "https://DIN-WORKER-URL/admin/users" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer DIN_TOKEN" \
  -d '{"initials":"NJ","pin":"1234","role":"admin"}'
```

Men du har endnu ikke et token… så du gør det sådan her første gang:

### Første admin (bootstrap)

1. Deploy backend.
2. Åbn Cloudflare dashboard → D1 → **komponent_db** → Console.
3. Indsæt en admin-bruger direkte i tabellen `users`:

- `initials` = fx `NJ`
- `role` = `admin`
- `pin_salt` og `pin_hash` skal være gyldige.

**Nemmere metode:** Brug `bootstrap-admin.js` (nedenfor) som genererer salt/hash og laver insert via `wrangler d1 execute`.

### Bootstrap script

Kør:

```bash
node bootstrap-admin.js NJ 1234
```

Det genererer en `INSERT`-SQL du kan copy/paste i D1 Console.

## 7) Kobl frontend på backend

I repo-roden (frontend) ligger der i `index.html`:

```js
window.COMPONENT_APP_API = "";
```

Sæt den til din Worker-URL (uden trailing slash), fx:

```js
window.COMPONENT_APP_API = "https://komponent-blanket-backend.<dit-subdomain>.workers.dev";
```

## 8) Opret brugere

Når du er logget ind som **admin** i app’en, får du knappen:

**“Admin: Opret bruger”**

Den opretter/overskriver en bruger (initialer + PIN).

---

### Tips
- Hvis du tester lokalt, er `ALLOWED_ORIGINS` sat til at tillade `http://localhost:5500`.
- Audit kan hentes via `GET /audit` eller `GET /audit?record_id=<id>`.
