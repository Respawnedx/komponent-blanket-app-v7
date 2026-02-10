// Cloudflare Worker backend for Komponent-blanket
// - User management (initials + PIN)
// - Records storage (shared across users)
// - Audit log per change

function nowIso() {
  return new Date().toISOString();
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2) throw new Error("Invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64UrlEncode(bytes) {
  let str = "";
  bytes.forEach(b => (str += String.fromCharCode(b)));
  const b64 = btoa(str);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeToBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256Hex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return toHex(sig);
}

function randomHex(nBytes = 16) {
  const arr = new Uint8Array(nBytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

async function pbkdf2Hash(pin, saltHex, iterations = 100_000) {
  const pinKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(saltHex),
      iterations,
      hash: "SHA-256",
    },
    pinKey,
    256
  );
  // store as hex
  return toHex(bits);
}

function parseAllowedOrigins(env) {
  const raw = (env.ALLOWED_ORIGINS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function corsHeaders(origin, allowed) {
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || "*");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, origin, allowed, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin, allowed) },
  });
}

function textResponse(text, origin, allowed, status = 200) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(origin, allowed) },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function getBearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7).trim();
}

async function signToken(env, payloadObj) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const payload = base64UrlEncode(payloadBytes);
  const sig = await hmacSha256Hex(env.TOKEN_SECRET, payload);
  return `${payload}.${sig}`;
}

async function verifyToken(env, token) {
  if (!token || token.indexOf(".") === -1) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expect = await hmacSha256Hex(env.TOKEN_SECRET, payload);
  if (expect !== sig) return null;

  let obj;
  try {
    obj = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(payload)));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof obj.exp !== "number" || now > obj.exp) return null;
  if (!obj.initials) return null;
  return obj;
}

async function requireAuth(env, request) {
  const token = getBearerToken(request);
  const tok = await verifyToken(env, token);
  if (!tok) return null;

  const row = await env.DB.prepare(
    "SELECT initials, role, disabled FROM users WHERE initials=?"
  ).bind(String(tok.initials)).first();

  if (!row || row.disabled) return null;
  return { initials: row.initials, role: row.role };
}

async function writeAudit(env, entry) {
  const ts = entry.ts || nowIso();
  const initials = entry.initials;
  const action = entry.action || "EVENT";
  const record_id = entry.record_id || null;
  const hovednr = entry.hovednr || null;
  const opsaetning = Number.isFinite(entry.opsaetning) ? entry.opsaetning : null;
  const tag = entry.tag || null;
  const field = entry.field || null;
  const value = entry.value !== undefined ? String(entry.value) : null;
  const meta = entry.meta ? JSON.stringify(entry.meta) : null;

  await env.DB.prepare(
    "INSERT INTO audit(ts, initials, action, record_id, hovednr, opsaetning, tag, field, value, meta) VALUES(?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(ts, initials, action, record_id, hovednr, opsaetning, tag, field, value, meta)
    .run();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = parseAllowedOrigins(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }

    const url = new URL(request.url);

    // health
    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, ts: nowIso() }, origin, allowed);
    }

    // --- Auth ---
    if (url.pathname === "/auth/login" && request.method === "POST") {
      const body = await readJson(request);
      const initials = String(body?.initials || "").trim().toUpperCase();
      const pin = String(body?.pin || "").trim();
      if (!initials || !pin) {
        return jsonResponse({ error: "initials+pin required" }, origin, allowed, 400);
      }

      const row = await env.DB.prepare(
        "SELECT initials, role, pin_salt, pin_hash, disabled FROM users WHERE initials=?"
      ).bind(initials).first();

      if (!row || row.disabled) {
        return jsonResponse({ error: "Unknown user" }, origin, allowed, 401);
      }

      const calc = await pbkdf2Hash(pin, row.pin_salt);
      if (calc !== row.pin_hash) {
        return jsonResponse({ error: "Bad credentials" }, origin, allowed, 401);
      }

      const ttl = Number(env.TOKEN_TTL_SECONDS || "604800");
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        initials: row.initials,
        role: row.role,
        iat: now,
        exp: now + ttl,
        jti: randomHex(8),
      };

      const token = await signToken(env, payload);
      await writeAudit(env, { initials: row.initials, action: "LOGIN" });
      return jsonResponse({ token, initials: row.initials, role: row.role }, origin, allowed);
    }

    if (url.pathname === "/auth/me" && request.method === "GET") {
      const user = await requireAuth(env, request);
      if (!user) return jsonResponse({ error: "Unauthorized" }, origin, allowed, 401);
      return jsonResponse({ initials: user.initials, role: user.role }, origin, allowed);
    }

    // --- Admin: users ---
    if (url.pathname === "/admin/users" && request.method === "GET") {
      const user = await requireAuth(env, request);
      if (!user || user.role !== "admin") return jsonResponse({ error: "Forbidden" }, origin, allowed, 403);

      const { results } = await env.DB.prepare(
        "SELECT initials, role, disabled, created_at, created_by FROM users ORDER BY initials"
      ).all();
      return jsonResponse({ users: results }, origin, allowed);
    }

    if (url.pathname === "/admin/users" && request.method === "POST") {
      const user = await requireAuth(env, request);
      if (!user || user.role !== "admin") return jsonResponse({ error: "Forbidden" }, origin, allowed, 403);

      const body = await readJson(request);
      const initials = String(body?.initials || "").trim().toUpperCase();
      const pin = String(body?.pin || "").trim();
      const role = String(body?.role || "user").trim().toLowerCase() === "admin" ? "admin" : "user";

      if (!initials || !pin) return jsonResponse({ error: "initials+pin required" }, origin, allowed, 400);
      if (!/^\d{4,8}$/.test(pin)) return jsonResponse({ error: "PIN must be 4-8 digits" }, origin, allowed, 400);

      const salt = randomHex(16);
      const hash = await pbkdf2Hash(pin, salt);
      const ts = nowIso();

      await env.DB.prepare(
        "INSERT INTO users(initials, role, pin_salt, pin_hash, disabled, created_at, created_by) VALUES(?,?,?,?,0,?,?) " +
        "ON CONFLICT(initials) DO UPDATE SET role=excluded.role, pin_salt=excluded.pin_salt, pin_hash=excluded.pin_hash, disabled=0"
      )
        .bind(initials, role, salt, hash, ts, user.initials)
        .run();

      await writeAudit(env, { initials: user.initials, action: "ADMIN_CREATE_USER", field: initials, value: role });
      return jsonResponse({ ok: true, initials, role }, origin, allowed);
    }

    // --- Records ---
    if (url.pathname === "/records" && request.method === "GET") {
      const user = await requireAuth(env, request);
      if (!user) return jsonResponse({ error: "Unauthorized" }, origin, allowed, 401);

      const { results } = await env.DB.prepare(
        "SELECT payload FROM records ORDER BY updated_at DESC LIMIT 500"
      ).all();

      const records = [];
      for (const r of results) {
        try {
          records.push(JSON.parse(r.payload));
        } catch {
          // ignore broken rows
        }
      }
      return jsonResponse({ records }, origin, allowed);
    }

    if (url.pathname === "/records/upsert" && request.method === "POST") {
      const user = await requireAuth(env, request);
      if (!user) return jsonResponse({ error: "Unauthorized" }, origin, allowed, 401);

      const rec = await readJson(request);
      if (!rec || !rec.id) return jsonResponse({ error: "record.id required" }, origin, allowed, 400);

      // Server-authoritative updated fields
      const ts = nowIso();
      rec.editedBy = user.initials;
      rec.updatedAt = ts;

      const hoved = String(rec.hovedkomponentnr || "");
      const desc = String(rec.beskrivelse || "");
      const anlaeg = String(rec.anlaeg || "");
      const pid = String(rec.pid || "");
      const sign1 = String(rec.signatur1 || "");
      const sign2 = String(rec.signatur2 || "");
      const selectedCount = Array.isArray(rec.selectedCodes) ? rec.selectedCodes.length : 0;

      // Determine created_at/by (if new)
      const existing = await env.DB.prepare("SELECT created_at, created_by FROM records WHERE id=?")
        .bind(String(rec.id))
        .first();

      const created_at = existing?.created_at || ts;
      const created_by = existing?.created_by || user.initials;

      await env.DB.prepare(
        "INSERT INTO records(id, hovedkomponentnr, beskrivelse, anlaeg, pid, signatur1, signatur2, selected_count, payload, created_at, created_by, updated_at, updated_by) " +
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) " +
        "ON CONFLICT(id) DO UPDATE SET hovedkomponentnr=excluded.hovedkomponentnr, beskrivelse=excluded.beskrivelse, anlaeg=excluded.anlaeg, pid=excluded.pid, signatur1=excluded.signatur1, signatur2=excluded.signatur2, selected_count=excluded.selected_count, payload=excluded.payload, updated_at=excluded.updated_at, updated_by=excluded.updated_by"
      )
        .bind(
          String(rec.id),
          hoved,
          desc,
          anlaeg,
          pid,
          sign1,
          sign2,
          selectedCount,
          JSON.stringify(rec),
          created_at,
          created_by,
          ts,
          user.initials
        )
        .run();

      await writeAudit(env, {
        initials: user.initials,
        action: existing ? "SAVE_EDIT" : "SAVE_CREATE",
        record_id: String(rec.id),
        hovednr: hoved || null,
        meta: { selectedCount },
      });

      return jsonResponse({ ok: true, record: rec }, origin, allowed);
    }

    // /records/:id
    if (url.pathname.startsWith("/records/") && request.method === "GET") {
      const user = await requireAuth(env, request);
      if (!user) return jsonResponse({ error: "Unauthorized" }, origin, allowed, 401);

      const id = decodeURIComponent(url.pathname.slice("/records/".length));
      const row = await env.DB.prepare("SELECT payload FROM records WHERE id=?").bind(id).first();
      if (!row) return jsonResponse({ error: "Not found" }, origin, allowed, 404);
      try {
        return jsonResponse({ record: JSON.parse(row.payload) }, origin, allowed);
      } catch {
        return jsonResponse({ error: "Corrupt payload" }, origin, allowed, 500);
      }
    }

    if (url.pathname.startsWith("/records/") && request.method === "DELETE") {
      const user = await requireAuth(env, request);
      if (!user) return jsonResponse({ error: "Unauthorized" }, origin, allowed, 401);

      const id = decodeURIComponent(url.pathname.slice("/records/".length));
      const row = await env.DB.prepare("SELECT hovedkomponentnr FROM records WHERE id=?").bind(id).first();
      await env.DB.prepare("DELETE FROM records WHERE id=?").bind(id).run();
      await writeAudit(env, {
        initials: user.initials,
        action: "DELETE_RECORD",
        record_id: id,
        hovednr: row?.hovedkomponentnr || null,
      });
      return jsonResponse({ ok: true }, origin, allowed);
    }

    // --- Audit ---
    if (url.pathname === "/audit" && request.method === "POST") {
      const user = await requireAuth(env, request);
      if (!user) return jsonResponse({ error: "Unauthorized" }, origin, allowed, 401);

      const body = await readJson(request);
      await writeAudit(env, {
        initials: user.initials,
        action: String(body?.action || "EVENT"),
        record_id: body?.record_id ? String(body.record_id) : null,
        hovednr: body?.hovednr ? String(body.hovednr) : null,
        opsaetning: Number.isFinite(body?.opsaetning) ? body.opsaetning : null,
        tag: body?.tag ? String(body.tag) : null,
        field: body?.field ? String(body.field) : null,
        value: body?.value,
        meta: body?.meta || null,
      });

      return jsonResponse({ ok: true }, origin, allowed);
    }

    if (url.pathname === "/audit" && request.method === "GET") {
      const user = await requireAuth(env, request);
      if (!user) return jsonResponse({ error: "Unauthorized" }, origin, allowed, 401);

      const record_id = url.searchParams.get("record_id") || null;
      let stmt;
      if (record_id) {
        stmt = env.DB.prepare("SELECT * FROM audit WHERE record_id=? ORDER BY id DESC LIMIT 500").bind(record_id);
      } else {
        stmt = env.DB.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 500");
      }
      const { results } = await stmt.all();
      return jsonResponse({ results }, origin, allowed);
    }

    return textResponse("Not found", origin, allowed, 404);
  },
};
