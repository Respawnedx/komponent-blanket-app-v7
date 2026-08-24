// Cloudflare Worker backend for Komponent-blanket
// - User management (initials/email + password)
// - Records storage (shared across users)
// - Audit log per change

function nowIso() {
  return new Date().toISOString();
}

function normalizeRole(role) {
  const raw = String(role || "user").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "admin") return "admin";
  if (["allocator", "planner", "semi_admin", "semiadmin", "editor", "manager"].includes(raw)) return "allocator";
  return "user";
}

function getTokenSecret(env) {
  return String(env?.TOKEN_SECRET || "").trim();
}

function constantTimeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  let diff = left.length ^ right.length;
  const len = Math.max(left.length, right.length);

  for (let i = 0; i < len; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }

  return diff === 0;
}

function canWriteRecords(user) {
  const role = normalizeRole(user?.role);
  return role === "admin" || role === "allocator";
}

function canManageUsers(user) {
  return normalizeRole(user?.role) === "admin";
}

function isPlannerOnly(user) {
  return normalizeRole(user?.role) === "allocator";
}

function normalizeLogin(value) {
  const raw = String(value || "").trim();
  if (raw.includes("@")) return raw.toLowerCase();
  return raw.toUpperCase();
}

function normalizeEmail(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : "";
}

function readPasswordSecret(body) {
  return String(body?.password ?? body?.pin ?? "").trim();
}

function passwordValidationError(secret) {
  if (!secret) return "password required";
  if (secret.length < 4 || secret.length > 64) return "Password must be 4-64 characters";
  return "";
}

const LOGIN_THROTTLE = {
  pair: { maxFailures: 8, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 },
  ip: { maxFailures: 30, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 },
};

function normalizeTagStatus(mark) {
  const raw = String(mark || "blue").trim().toLowerCase();
  if (["reserved", "project", "temporary"].includes(raw)) return "reserved";
  if (["red", "free", "removed"].includes(raw)) return "red";
  return "blue";
}

function getRecordStatus(rec, code) {
  const meta = rec?.codeMeta && typeof rec.codeMeta === "object" ? rec.codeMeta : {};
  return normalizeTagStatus(meta?.[code]?.mark || "blue");
}

function plannerMutationError(prevRec, rec) {
  if (!prevRec) {
    const codes = (Array.isArray(rec?.selectedCodes) ? rec.selectedCodes : []).map(String);
    if (!codes.length) return "Planner must select at least one project reservation";
    for (const code of codes) {
      if (getRecordStatus(rec, code) !== "reserved") {
        return `Planner can only create records with project reservations (${code})`;
      }
    }
    return "";
  }

  const lockedFields = ["hovedkomponentnr", "beskrivelse", "anlaeg", "pid", "signatur1", "signatur2"];
  for (const key of lockedFields) {
    if (String(prevRec?.[key] || "") !== String(rec?.[key] || "")) {
      return `Planner cannot change field: ${key}`;
    }
  }

  const oldSet = new Set((Array.isArray(prevRec.selectedCodes) ? prevRec.selectedCodes : []).map(String));
  const newSet = new Set((Array.isArray(rec.selectedCodes) ? rec.selectedCodes : []).map(String));
  const all = new Set([...oldSet, ...newSet]);

  for (const code of all) {
    const oldHas = oldSet.has(code);
    const newHas = newSet.has(code);
    const oldStatus = oldHas ? getRecordStatus(prevRec, code) : null;
    const newStatus = newHas ? getRecordStatus(rec, code) : null;

    if (!oldHas && newHas && newStatus !== "reserved") return `Planner can only add project reservations (${code})`;
    if (oldHas && !newHas && oldStatus !== "reserved") return `Planner can only remove project reservations (${code})`;
    if (oldHas && newHas && oldStatus !== newStatus) return `Planner cannot change status (${code})`;
  }

  return "";
}

function parseMainNumber(raw) {
  const str = String(raw || "").trim();
  if (!str) return "";
  const m1 = str.match(/^\s*(\d{1,10})/);
  if (m1) return m1[1];
  const m2 = str.match(/\b(\d{1,10})\b/);
  return m2 ? m2[1] : "";
}

function stripLeadingZeros(numStr) {
  const t = String(numStr || "");
  if (!t) return "";
  const n = parseInt(t, 10);
  if (!Number.isFinite(n)) return t.replace(/^0+(?=\d)/, "");
  return String(n);
}

function validateSingleMainNumber(raw) {
  const str = String(raw || "").trim();
  if (!str) return { ok: false, message: "hovedkomponentnr required" };

  // Only treat 4+ digit groups as 'main numbers' to avoid catching 01-99 / 101-199 etc.
  const groups = [...str.matchAll(/\b\d{4,10}\b/g)].map(m => m[0]);
  if (groups.length <= 1) return { ok: true, main: parseMainNumber(str) };

  const first = stripLeadingZeros(groups[0]);
  const others = groups.slice(1).map(stripLeadingZeros).filter(x => x && x !== first);
  const uniq = [...new Set([first, ...others])];

  if (uniq.length > 1) {
    return { ok: false, message: `Multiple main numbers: ${uniq.join(", ")}` };
  }
  return { ok: true, main: parseMainNumber(str) };
}

async function findDuplicateMainRecord(env, hoved, currentId) {
  const normalized = stripLeadingZeros(hoved);
  if (!normalized) return null;

  const { results } = await env.DB.prepare(
    "SELECT id, hovedkomponentnr FROM records WHERE id<>?"
  ).bind(String(currentId)).all();

  return (results || []).find(row => stripLeadingZeros(row?.hovedkomponentnr) === normalized) || null;
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

async function pbkdf2Hash(secret, saltHex, iterations = 100_000) {
  const secretKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
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
    secretKey,
    256
  );
  // store as hex
  return toHex(bits);
}

function isoToMs(iso) {
  const ms = Date.parse(String(iso || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function clientIpFromRequest(request) {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get("X-Forwarded-For") || "";
  return forwarded.split(",")[0].trim() || "unknown";
}

async function throttleHash(env, value) {
  return hmacSha256Hex(getTokenSecret(env), String(value || "unknown"));
}

async function loginThrottleKeys(env, request, login) {
  const normalizedLogin = normalizeLogin(login || "blank");
  const ip = clientIpFromRequest(request);
  const [pairHash, ipHash] = await Promise.all([
    throttleHash(env, `${normalizedLogin}|${ip}`),
    throttleHash(env, ip),
  ]);
  return [
    { key: `pair:${pairHash}`, scope: "pair", config: LOGIN_THROTTLE.pair },
    { key: `ip:${ipHash}`, scope: "ip", config: LOGIN_THROTTLE.ip },
  ];
}

async function getLoginThrottleBlock(env, keys) {
  const now = Date.now();
  let longestWaitSeconds = 0;

  for (const item of keys) {
    const row = await env.DB.prepare(
      "SELECT locked_until FROM login_throttle WHERE key=?"
    ).bind(item.key).first();

    const lockedUntil = isoToMs(row?.locked_until);
    if (lockedUntil > now) {
      longestWaitSeconds = Math.max(longestWaitSeconds, Math.ceil((lockedUntil - now) / 1000));
    }
  }

  return longestWaitSeconds > 0 ? { retryAfterSeconds: longestWaitSeconds } : null;
}

async function recordLoginFailure(env, keys) {
  const now = Date.now();
  const nowText = new Date(now).toISOString();

  for (const item of keys) {
    const row = await env.DB.prepare(
      "SELECT failures, first_failed_at, locked_until FROM login_throttle WHERE key=?"
    ).bind(item.key).first();

    const firstMs = isoToMs(row?.first_failed_at);
    const insideWindow = firstMs && (now - firstMs) <= item.config.windowMs;
    const failures = insideWindow ? Number(row?.failures || 0) + 1 : 1;
    const firstFailedAt = insideWindow ? String(row?.first_failed_at || nowText) : nowText;

    const lockMultiplier = Math.max(1, Math.ceil(failures / item.config.maxFailures));
    const lockedUntil = failures >= item.config.maxFailures
      ? new Date(now + Math.min(item.config.lockMs * lockMultiplier, 60 * 60 * 1000)).toISOString()
      : null;

    await env.DB.prepare(
      "INSERT INTO login_throttle(key, scope, failures, first_failed_at, last_failed_at, locked_until, updated_at) VALUES(?,?,?,?,?,?,?) " +
      "ON CONFLICT(key) DO UPDATE SET failures=excluded.failures, first_failed_at=excluded.first_failed_at, last_failed_at=excluded.last_failed_at, locked_until=excluded.locked_until, updated_at=excluded.updated_at"
    )
      .bind(item.key, item.scope, failures, firstFailedAt, nowText, lockedUntil, nowText)
      .run();
  }
}

async function clearLoginThrottle(env, keys) {
  for (const item of keys) {
    await env.DB.prepare("DELETE FROM login_throttle WHERE key=?").bind(item.key).run();
  }
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
  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };

  let allowOrigin = null;
  if (origin) {
    if (allowed && allowed.length) {
      if (allowed.includes("*") || allowed.includes(origin)) allowOrigin = allowed.includes("*") ? "*" : origin;
    }
  } else {
    allowOrigin = "*";
  }

  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}

function jsonResponse(data, origin, allowed, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin, allowed), ...extraHeaders },
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
  const sig = await hmacSha256Hex(getTokenSecret(env), payload);
  return `${payload}.${sig}`;
}

async function verifyToken(env, token) {
  if (!token || token.indexOf(".") === -1) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  const expect = await hmacSha256Hex(getTokenSecret(env), payload);
  if (!constantTimeEqual(expect, sig)) return null;

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
    "SELECT initials, email, role, disabled FROM users WHERE initials=?"
  ).bind(String(tok.initials)).first();

  if (!row || row.disabled) return null;
  return { initials: row.initials, email: row.email || "", role: normalizeRole(row.role) };
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

    if (!getTokenSecret(env)) {
      return jsonResponse({ error: "TOKEN_SECRET is not configured" }, origin, allowed, 500);
    }

    // --- Auth ---
    if (url.pathname === "/auth/login" && request.method === "POST") {
      const body = await readJson(request);
      const login = normalizeLogin(body?.login || body?.initials || body?.email || "");
      const password = readPasswordSecret(body);
      if (!login || !password) {
        return jsonResponse({ error: "login+password required" }, origin, allowed, 400);
      }

      const throttleKeys = await loginThrottleKeys(env, request, login);
      const throttleBlock = await getLoginThrottleBlock(env, throttleKeys);
      if (throttleBlock) {
        await writeAudit(env, {
          initials: "AUTH",
          action: "LOGIN_THROTTLED",
          field: "login",
          value: login.includes("@") ? "email" : login,
          meta: { retryAfterSeconds: throttleBlock.retryAfterSeconds },
        });
        return jsonResponse(
          { error: "Too many login attempts. Try again later.", retryAfterSeconds: throttleBlock.retryAfterSeconds },
          origin,
          allowed,
          429,
          { "Retry-After": String(throttleBlock.retryAfterSeconds) }
        );
      }

      const row = login.includes("@")
        ? await env.DB.prepare(
          "SELECT initials, email, role, pin_salt, pin_hash, disabled FROM users WHERE lower(email)=lower(?)"
        ).bind(login).first()
        : await env.DB.prepare(
          "SELECT initials, email, role, pin_salt, pin_hash, disabled FROM users WHERE initials=?"
        ).bind(login).first();

      if (!row || row.disabled) {
        await recordLoginFailure(env, throttleKeys);
        await writeAudit(env, {
          initials: "AUTH",
          action: "LOGIN_FAILED",
          field: "login",
          value: login.includes("@") ? "email" : login,
          meta: { reason: "bad_credentials" },
        });
        return jsonResponse({ error: "Bad credentials" }, origin, allowed, 401);
      }

      const calc = await pbkdf2Hash(password, row.pin_salt);
      if (!constantTimeEqual(calc, row.pin_hash)) {
        await recordLoginFailure(env, throttleKeys);
        await writeAudit(env, {
          initials: row.initials || "AUTH",
          action: "LOGIN_FAILED",
          field: "login",
          value: row.initials || (login.includes("@") ? "email" : login),
          meta: { reason: "bad_credentials" },
        });
        return jsonResponse({ error: "Bad credentials" }, origin, allowed, 401);
      }

      await clearLoginThrottle(env, throttleKeys);

      const ttl = Number(env.TOKEN_TTL_SECONDS || "604800");
      const now = Math.floor(Date.now() / 1000);
      const role = normalizeRole(row.role);
      const payload = {
        initials: row.initials,
        role,
        iat: now,
        exp: now + ttl,
        jti: randomHex(8),
      };

      const token = await signToken(env, payload);
      await writeAudit(env, { initials: row.initials, action: "LOGIN" });
      return jsonResponse({ token, initials: row.initials, email: row.email || "", role }, origin, allowed);
    }

    if (url.pathname === "/auth/me" && request.method === "GET") {
      const user = await requireAuth(env, request);
      if (!user) return jsonResponse({ error: "Unauthorized" }, origin, allowed, 401);
      return jsonResponse({ initials: user.initials, email: user.email || "", role: user.role }, origin, allowed);
    }

    // --- Admin: users ---
    if (url.pathname === "/admin/users" && request.method === "GET") {
      const user = await requireAuth(env, request);
      if (!user || !canManageUsers(user)) return jsonResponse({ error: "Forbidden" }, origin, allowed, 403);

      const { results } = await env.DB.prepare(
        "SELECT initials, email, role, disabled, created_at, created_by FROM users ORDER BY initials"
      ).all();
      return jsonResponse({ users: results }, origin, allowed);
    }

    if (url.pathname === "/admin/users" && request.method === "POST") {
      const user = await requireAuth(env, request);
      if (!user || !canManageUsers(user)) return jsonResponse({ error: "Forbidden" }, origin, allowed, 403);

      const body = await readJson(request);
      const initials = String(body?.initials || "").trim().toUpperCase();
      const email = normalizeEmail(body?.email || "");
      const password = readPasswordSecret(body);
      const role = normalizeRole(body?.role || "user");

      if (!initials || !password) return jsonResponse({ error: "initials+password required" }, origin, allowed, 400);
      const passwordError = passwordValidationError(password);
      if (passwordError) return jsonResponse({ error: passwordError }, origin, allowed, 400);
      if (body?.email && !email) return jsonResponse({ error: "Invalid email" }, origin, allowed, 400);

      const salt = randomHex(16);
      const hash = await pbkdf2Hash(password, salt);
      const ts = nowIso();

      await env.DB.prepare(
        "INSERT INTO users(initials, email, role, pin_salt, pin_hash, disabled, created_at, created_by) VALUES(?,?,?,?,?,0,?,?) " +
        "ON CONFLICT(initials) DO UPDATE SET email=excluded.email, role=excluded.role, pin_salt=excluded.pin_salt, pin_hash=excluded.pin_hash, disabled=0"
      )
        .bind(initials, email || null, role, salt, hash, ts, user.initials)
        .run();

      await writeAudit(env, { initials: user.initials, action: "ADMIN_CREATE_USER", field: initials, value: role, meta: { email: email || null } });
      return jsonResponse({ ok: true, initials, email, role }, origin, allowed);
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
      if (!canWriteRecords(user)) return jsonResponse({ error: "Semi-admin or admin access required" }, origin, allowed, 403);

      const rec = await readJson(request);
      if (!rec || !rec.id) return jsonResponse({ error: "record.id required" }, origin, allowed, 400);

      const submittedBaseUpdatedAt = String(rec._baseUpdatedAt || rec.baseUpdatedAt || "").trim();
      delete rec._baseUpdatedAt;
      delete rec.baseUpdatedAt;

      // Server-authoritative updated fields
      const ts = nowIso();
      rec.editedBy = user.initials;
      rec.updatedAt = ts;

      const vMain = validateSingleMainNumber(rec.hovedkomponentnr);
      if(!vMain.ok) return jsonResponse({ error: vMain.message || "Invalid hovedkomponentnr" }, origin, allowed, 400);
      const hoved = String(vMain.main || "");
      rec.hovedkomponentnr = hoved;
      const desc = String(rec.beskrivelse || "");
      const anlaeg = String(rec.anlaeg || "");
      const pid = String(rec.pid || "");
      const sign1 = String(rec.signatur1 || "");
      const sign2 = String(rec.signatur2 || "");
      const selectedCount = Array.isArray(rec.selectedCodes) ? rec.selectedCodes.length : 0;

      // Determine created_at/by (if new)
      const existing = await env.DB.prepare("SELECT created_at, created_by, updated_at, updated_by, payload FROM records WHERE id=?")
        .bind(String(rec.id))
        .first();

      if (existing && submittedBaseUpdatedAt && existing.updated_at && existing.updated_at !== submittedBaseUpdatedAt) {
        let currentRecord = null;
        try {
          currentRecord = existing.payload ? JSON.parse(existing.payload) : null;
        } catch {
          currentRecord = null;
        }
        return jsonResponse({
          error: "Record was changed by another user. Refresh before saving.",
          conflict: true,
          currentUpdatedAt: existing.updated_at,
          currentUpdatedBy: existing.updated_by || null,
          record: currentRecord,
        }, origin, allowed, 409);
      }

      const duplicateMain = await findDuplicateMainRecord(env, hoved, rec.id);
      if (duplicateMain) {
        return jsonResponse({
          error: `Main component number ${hoved} already exists in another record.`,
          duplicate: true,
          existingRecordId: duplicateMain.id,
          existingMain: duplicateMain.hovedkomponentnr || null,
        }, origin, allowed, 409);
      }

      const created_at = existing?.created_at || ts;
      const created_by = existing?.created_by || user.initials;

      if (isPlannerOnly(user)) {
        let prevRec = null;
        if (existing?.payload) {
          try {
            prevRec = JSON.parse(existing.payload);
          } catch {
            prevRec = null;
          }
        }
        const plannerError = plannerMutationError(prevRec, rec);
        if (plannerError) return jsonResponse({ error: plannerError }, origin, allowed, 403);
      }

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
        meta: { selectedCount, revision: (Array.isArray(rec.revisions) ? (rec.revisions.slice(-1)[0]?.desc || null) : null) },
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
      if (!canManageUsers(user)) return jsonResponse({ error: "Admin access required" }, origin, allowed, 403);

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
      if (!canWriteRecords(user)) return jsonResponse({ error: "Semi-admin or admin access required" }, origin, allowed, 403);

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
