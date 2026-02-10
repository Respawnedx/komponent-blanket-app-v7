// Simple local-only "app" to match the scanned UX.
// - Builds checkbox grids for the ranges
// - Shows selected codes
// - Saves/loads multiple records to localStorage
// - Exports JSON
//
// No backend required.

const STORAGE_KEY = "componentFormRecords_v1";


const el = (id) => document.getElementById(id);

const fields = {
  main: el("fMain"),
  desc: el("fDesc"),
  plant: el("fPlant"),
  pid: el("fPid"),
  sign1: el("fSign1"),
  sign2: el("fSign2"),
};

const selectedCodesEl = el("selectedCodes");
const recordListEl = el("recordList");
const searchEl = el("search");

let activeId = null;
// codeSource: {'01':'scan'|'manual'} for currently checked codes
let codeSource = {};
// codeMeta: {'01': {by:'NIJEY', at:'ISO', source:'manual'|'scan'}} for currently checked codes
let codeMeta = {};
// buffer of unsaved fine-grained changes (checkbox clicks etc.)
let changeBuffer = [];

// ---------- Build checkbox grids ----------
function parseRange(rangeStr){
  const [a,b] = rangeStr.split("-").map(s=>parseInt(s.trim(),10));
  return {a,b};
}
function pad2(n){ return String(n).padStart(2,"0"); }


// ---------- Auth + API (Cloudflare backend) ----------
// Hvis window.COMPONENT_APP_API (i index.html) er sat, kører app'en i cloud-mode.
// Ellers falder den tilbage til lokal/offline mode (localStorage).
const AUTH_KEY = "componentFormAuth_v2";
const API_BASE = (window.COMPONENT_APP_API || "").trim().replace(/\/+$/,"");
const USE_CLOUD = !!API_BASE;

// Local fallback storage key (bruges kun hvis USE_CLOUD=false)
const USER_KEY = "componentFormUser_v1"; // legacy key for backward compatibility

function getAuth(){
  try{
    const raw = localStorage.getItem(AUTH_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch{
    return null;
  }
}

function setAuth(auth){
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  updateUserBadge();
}

function clearAuth(){
  localStorage.removeItem(AUTH_KEY);
  updateUserBadge();
}

function getCurrentUser(){
  const auth = getAuth();
  return auth?.user ?? null;
}

function getToken(){
  const auth = getAuth();
  return auth?.token ?? null;
}

async function apiFetch(path, opts = {}){
  if(!USE_CLOUD) throw new Error("API_BASE er ikke sat (lokal mode).");
  const url = API_BASE + path;

  const headers = new Headers(opts.headers || {});
  if(!headers.has("Content-Type") && opts.body) headers.set("Content-Type","application/json");

  if(!opts.noAuth){
    const token = getToken();
    if(token) headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, { ...opts, headers });
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const payload = isJson ? await res.json().catch(()=>null) : await res.text().catch(()=>null);

  if(!res.ok){
    const msg = (payload && payload.error) ? payload.error : (typeof payload === "string" ? payload : res.statusText);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return payload;
}

async function cloudLogin(initials, pin){
  return apiFetch("/auth/login", {
    method: "POST",
    noAuth: true,
    body: JSON.stringify({ initials, pin }),
  });
}

async function cloudCreateUser(initials, pin, role="user"){
  return apiFetch("/admin/users", {
    method: "POST",
    body: JSON.stringify({ initials, pin, role }),
  });
}

function requireLogin(reason = "Du skal være logget ind for at kunne redigere."){
  const user = getCurrentUser();
  if(user) return user;
  alert(reason);
  openLogin();
  return null;
}

function updateUserBadge(){
  const badge = document.getElementById("userBadge");
  const user = getCurrentUser();
  if(!badge) return;

  const mode = USE_CLOUD ? "cloud" : "lokal";

  if(!user){
    badge.textContent = `Ikke logget ind (${mode})`;
    badge.style.color = "var(--muted)";
    setEditingEnabled(false);
    updateAdminUi();
    return;
  }

  badge.textContent = `${user.initials}${user.role === "admin" ? " (admin)" : ""} (${mode})`;
  badge.style.color = "#111";
  setEditingEnabled(true);
  updateAdminUi();
}

function updateAdminUi(){
  const btn = document.getElementById("btnAdminCreateUser");
  const user = getCurrentUser();
  if(!btn) return;
  const show = USE_CLOUD && user && user.role === "admin";
  btn.style.display = show ? "inline-flex" : "none";
}

function setEditingEnabled(enabled){
  // Checkboxes
  getAllCheckboxes().forEach(cb => cb.disabled = !enabled);

  // Buttons that mutate checkmarks / data
  const btnOCR = document.getElementById("btnOCR");
  if(btnOCR) btnOCR.disabled = !enabled;

  const btnSave = document.getElementById("btnSave");
  if(btnSave) btnSave.disabled = !enabled;

  const hint = document.getElementById("statusHint");
  if(hint){
    hint.textContent = enabled
      ? "Klik for at sætte/fjerne kryds"
      : "Log ind for at kunne sætte/fjerne kryds";
  }
}


function summarizeSources(rec){
  const sources = rec.codeSources || {};
  let scan = 0, manual = 0;
  (rec.selectedCodes || []).forEach(c => {
    if(sources[c] === "scan") scan++;
    else manual++;
  });
  return {scan, manual};
}


function buildGrid(gridEl){
  const {a,b} = parseRange(gridEl.dataset.range);
  gridEl.innerHTML = "";

  for(let i=a;i<=b;i++){
    const wrap = document.createElement("label");
    wrap.className = "item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "cb";
    cb.dataset.code = pad2(i);
    cb.addEventListener("change", () => {
      const user = getCurrentUser();
      if(!user){
        // Revert and ask for login
        cb.checked = !cb.checked;
        requireLogin("Du skal være logget ind for at kunne sætte krydser.");
        return;
      }

      const code = cb.dataset.code;
      const now = new Date().toISOString();

      if(cb.checked){
        codeSource[code] = "manual";
        codeMeta[code] = { by: user.initials, at: now, source: "manual" };
        changeBuffer.push({ at: now, by: user.initials, action: "CHECK", code, source: "manual" });
      }else{
        delete codeSource[code];
        delete codeMeta[code];
        changeBuffer.push({ at: now, by: user.initials, action: "UNCHECK", code, source: "manual" });
      }

updateSelectedCodes();

// Send audit til backend (ikke bloker UX)
const mainNr = (fields.main.value || "").trim();
logAudit({
  action: cb.checked ? "CHECK" : "UNCHECK",
  record_id: activeId,
  hovednr: mainNr || null,
  opsaetning: parseInt(code, 10),
  tag: mainNr ? `${mainNr}.${code}` : null,
  meta: { source: "manual" }
});
    });

    const code = document.createElement("span");
    code.className = "code";
    code.textContent = pad2(i);

    wrap.appendChild(cb);
    wrap.appendChild(code);
    gridEl.appendChild(wrap);
  }

  // Special layout tweak for 1-29 (to mimic the scan):
  // We want 01-09, 10-19, 20-29 in three rows.
  // Using CSS grid with 9 columns already approximates it; we nudge 10-29 into the next rows by inserting "spacers".
  if(a === 1 && b === 29){
    // Insert one spacer after 09 to start 10 on next row
    // and one spacer after 19 to start 20 on next row.
    // With 9 columns, adding 0..8 spacers can push next items.
    // We add 0 here because 1-9 already fill the first row exactly.
    // But browsers may pack; this keeps it consistent by forcing breaks:
    const break1 = document.createElement("div");
    break1.style.gridColumn = "1 / -1";
    break1.style.height = "0";
    gridEl.insertBefore(break1, gridEl.children[9]); // before 10

    const break2 = document.createElement("div");
    break2.style.gridColumn = "1 / -1";
    break2.style.height = "0";
    gridEl.insertBefore(break2, gridEl.children[20+1]); // before 20 (account for earlier break)
  }
}

document.querySelectorAll(".grid").forEach(buildGrid);

// ---------- Read / write form state ----------
function getAllCheckboxes(){
  return Array.from(document.querySelectorAll(".cb"));
}
function getSelectedCodes(){
  const codes = getAllCheckboxes()
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.code)
    .sort((x,y)=>parseInt(x,10)-parseInt(y,10));
  return codes;
}
function setSelectedCodes(codes, source="manual"){
  const set = new Set(codes);
  // reset sources for any codes not in set
  codeSource = {};
  getAllCheckboxes().forEach(cb => {
    const code = cb.dataset.code;
    cb.checked = set.has(code);
    if(cb.checked){
      codeSource[code] = source;
    }
  });
  updateSelectedCodes();
}
function updateSelectedCodes(){
  const codes = getSelectedCodes();
  selectedCodesEl.textContent = codes.length ? codes.join(";") : "—";

  // Apply coloring based on source (scan/manual)
  getAllCheckboxes().forEach(cb => {
    const code = cb.dataset.code;
    if(cb.checked){
      const src = codeSource[code] || "manual";
      cb.dataset.source = src;

      const meta = codeMeta[code];
      if(meta?.by){
        const when = meta.at ? new Date(meta.at).toLocaleString() : "";
        cb.title = `${meta.by}${when ? " — " + when : ""}${meta.source ? " (" + meta.source + ")" : ""}`;
      }else{
        cb.removeAttribute("title");
      }
    }else{
      delete cb.dataset.source;
      cb.removeAttribute("title");
    }
  });
}

function clearForm(){
  activeId = null;
  changeBuffer = [];
  codeMeta = {};
  fields.main.value = "";
  fields.desc.value = "";
  fields.plant.value = "";
  fields.pid.value = "";
  fields.sign1.value = "";
  fields.sign2.value = "";
  setSelectedCodes([]);
  renderRecordList();
}

function getFormData(){
  const user = getCurrentUser();
  const existing = activeId ? loadRecords().find(r => r.id === activeId) : null;
  const nowIso = new Date().toISOString();

  const rec = {
    id: activeId ?? crypto.randomUUID(),
    hovedkomponentnr: fields.main.value.trim(),
    beskrivelse: fields.desc.value.trim(),
    anlaeg: fields.plant.value.trim(),
    pid: fields.pid.value.trim(),
    signatur1: fields.sign1.value.trim(),
    signatur2: fields.sign2.value.trim(),
    selectedCodes: getSelectedCodes(),
    codeSources: {...codeSource},          // per code: scan/manual
    codeMeta: {},                          // filled below
    editedBy: user?.initials ?? "—",
    updatedAt: nowIso,
    audit: Array.isArray(existing?.audit) ? [...existing.audit] : [],
  };

  // Keep only metadata for selected codes; add defaults if missing
  const selSet = new Set(rec.selectedCodes);
  const metaOut = {};
  for(const code of rec.selectedCodes){
    if(codeMeta[code]){
      metaOut[code] = codeMeta[code];
    }else{
      metaOut[code] = {
        by: user?.initials ?? "—",
        at: nowIso,
        source: (codeSource[code] || "manual"),
      };
    }
  }
  rec.codeMeta = metaOut;
  codeMeta = {...metaOut};

  // Append buffered checkbox changes (fine-grained)
  if(Array.isArray(changeBuffer) && changeBuffer.length){
    rec.audit.push(...changeBuffer.map(e => ({
      at: e.at,
      by: e.by,
      action: e.action,
      code: e.code,
      source: e.source,
    })));
  }

  // Append audit entry (diff from existing)
  const oldCodes = new Set(existing?.selectedCodes ?? []);
  const newCodes = new Set(rec.selectedCodes);

  const added = [...newCodes].filter(x => !oldCodes.has(x));
  const removed = [...oldCodes].filter(x => !newCodes.has(x));

  rec.audit.push({
    at: rec.updatedAt,
    by: rec.editedBy,
    action: existing ? "EDIT" : "CREATE",
    added,
    removed,
    sourceSummary: summarizeSources(rec),
  });

  return rec;
}

function setFormData(rec){
  activeId = rec.id;
  changeBuffer = [];
  fields.main.value = rec.hovedkomponentnr ?? "";
  fields.desc.value = rec.beskrivelse ?? "";
  fields.plant.value = rec.anlaeg ?? "";
  fields.pid.value = rec.pid ?? "";
  fields.sign1.value = rec.signatur1 ?? "";
  fields.sign2.value = rec.signatur2 ?? "";

  // Restore sources; default manual
  codeSource = rec.codeSources ?? {};
  codeMeta = rec.codeMeta ?? {};
  setSelectedCodes(rec.selectedCodes ?? [], "manual"); // setSelectedCodes resets codeSource, so reapply below

  // Reapply source colors
  const set = new Set(rec.selectedCodes ?? []);
  getAllCheckboxes().forEach(cb => {
    const code = cb.dataset.code;
    if(set.has(code)){
      cb.checked = true;
      codeSource[code] = (rec.codeSources && rec.codeSources[code]) ? rec.codeSources[code] : "manual";
    }
  });
  updateSelectedCodes();
}


// ---------- Storage (lokal vs cloud) ----------
let recordsCache = [];

function loadRecordsLocal(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}
function saveRecordsLocal(records){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function loadRecords(){
  return USE_CLOUD ? recordsCache : loadRecordsLocal();
}

async function refreshRecords(){
  if(!USE_CLOUD){
    recordsCache = [];
    renderRecordList();
    return;
  }
  const user = getCurrentUser();
  if(!user){
    recordsCache = [];
    renderRecordList();
    return;
  }
  const data = await apiFetch("/records", { method: "GET" });
  recordsCache = Array.isArray(data?.records) ? data.records : [];
  renderRecordList();
}

async function upsertRecord(rec){
  if(!USE_CLOUD){
    const records = loadRecordsLocal();
    const idx = records.findIndex(r => r.id === rec.id);
    if(idx >= 0) records[idx] = rec;
    else records.unshift(rec);
    saveRecordsLocal(records);
    return records;
  }

  const data = await apiFetch("/records/upsert", {
    method: "POST",
    body: JSON.stringify(rec),
  });

  const saved = data?.record || rec;
  const idx = recordsCache.findIndex(r => r.id === saved.id);
  if(idx >= 0) recordsCache[idx] = saved;
  else recordsCache.unshift(saved);

  return recordsCache;
}

async function deleteRecord(id){
  if(!USE_CLOUD){
    const records = loadRecordsLocal().filter(r => r.id !== id);
    saveRecordsLocal(records);
    if(activeId === id) activeId = null;
    return records;
  }

  await apiFetch(`/records/${encodeURIComponent(id)}`, { method: "DELETE" });
  recordsCache = recordsCache.filter(r => r.id !== id);
  if(activeId === id) activeId = null;
  return recordsCache;
}

async function logAudit(entry){
  if(!USE_CLOUD) return;
  const user = getCurrentUser();
  if(!user) return;

  try{
    await apiFetch("/audit", {
      method: "POST",
      body: JSON.stringify(entry),
    });
  }catch(err){
    // Don't block UX if audit fails
    console.warn("audit failed:", err?.message ?? err);
  }
}


// ---------- List rendering ----------
function matchesSearch(rec, q){
  if(!q) return true;
  const hay = [
    rec.hovedkomponentnr, rec.beskrivelse, rec.anlaeg, rec.pid,
    (rec.selectedCodes||[]).join(";")
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

function renderRecordList(){
  const q = (searchEl.value || "").trim().toLowerCase();
  const records = loadRecords().filter(r => matchesSearch(r,q));

  recordListEl.innerHTML = "";
  if(records.length === 0){
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Ingen gemte poster endnu.";
    recordListEl.appendChild(empty);
    return;
  }

  records.forEach(rec => {
    const card = document.createElement("div");
    card.className = "record" + (rec.id === activeId ? " record--active" : "");
    card.addEventListener("click", () => {
      setFormData(rec);
      renderRecordList();
    });

    const top = document.createElement("div");
    top.className = "record__top";

    const title = document.createElement("div");
    title.className = "record__title";
    title.textContent = rec.hovedkomponentnr || "(uden nr.)";

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = (rec.selectedCodes?.length ?? 0) + " felter";

    top.appendChild(title);
    top.appendChild(badge);

    const meta = document.createElement("div");
    meta.className = "record__meta";
    meta.innerHTML =
      `<div><strong>Anlæg:</strong> ${escapeHtml(rec.anlaeg || "—")} <strong>PID:</strong> ${escapeHtml(rec.pid || "—")}</div>` +
      `<div>${escapeHtml(rec.beskrivelse || "")}</div>` +
      `<div class="muted">${new Date(rec.updatedAt).toLocaleString()}</div>`;

    const actions = document.createElement("div");
    actions.style.marginTop = "8px";
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const btnDel = document.createElement("button");
    btnDel.className = "btn";
    btnDel.textContent = "Slet";
    btnDel.addEventListener("click", (e) => {
      e.stopPropagation();
      if(confirm("Slet posten?")){
        (async () => {
          try{
            await deleteRecord(rec.id);
            if(activeId === rec.id) clearForm();
            renderRecordList();
            await logAudit({ action: "DELETE", record_id: rec.id, hovednr: rec.hovedkomponentnr || null });
          }catch(err){
            alert("Kunne ikke slette: " + (err?.message ?? err));
          }
        })();
      }
    });

    const btnUse = document.createElement("button");
    btnUse.className = "btn btn--primary";
    btnUse.textContent = "Åbn";
    btnUse.addEventListener("click", (e) => {
      e.stopPropagation();
      setFormData(rec);
      renderRecordList();
    });

    actions.appendChild(btnUse);
    actions.appendChild(btnDel);

    card.appendChild(top);
    card.appendChild(meta);
    card.appendChild(actions);

    recordListEl.appendChild(card);
  });
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}


// Import JSON (backup)
const importFile = document.getElementById("importFile");
document.getElementById("btnImport").addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if(!file) return;
  try{
    const text = await file.text();
    const records = JSON.parse(text);
    if(!Array.isArray(records)) throw new Error("JSON skal være en liste (array) af poster.");

    if(USE_CLOUD){
      const user = requireLogin("Du skal være logget ind for at importere til cloud.");
      if(!user) return;

      if(!confirm("Importér til cloud? (OK = cloud, Annuller = lokal)")){
        saveRecordsLocal(records);
        activeId = records[0]?.id ?? null;
        if(activeId) setFormData(records[0]);
        renderRecordList();
        alert("Importeret lokalt.");
        return;
      }

      // Cloud import: upsert én for én
      for(const r of records){
        if(r && r.id){
          await upsertRecord(r);
        }
      }
      await refreshRecords();
      alert("Importeret til cloud.");
      return;
    }

    // Lokal import
    saveRecordsLocal(records);
    activeId = records[0]?.id ?? null;
    if(activeId) setFormData(records[0]);
    renderRecordList();
    alert("Importeret.");
  }catch(err){
    alert("Kunne ikke importere: " + (err?.message ?? err));
  }finally{
    importFile.value = "";
  }
});


// ---------- OCR (checkbox detection from scan) ----------
// NOTE: This is NOT text OCR. It's checkbox mark detection by sampling pixel darkness.
// It works best when the scan is a straight, full-page scan (A4 portrait) with little rotation.

const scanFile = document.getElementById("scanFile");
document.getElementById("btnOCR").addEventListener("click", () => scanFile.click());

scanFile.addEventListener("change", async () => {
  const file = scanFile.files?.[0];
  if(!file) return;

  const user = requireLogin("Du skal være logget ind for at køre OCR (det ændrer krydser og logger initialer).");
  if(!user){
    scanFile.value = "";
    return;
  }

  try{
    const img = await loadImageFromFile(file);

    // Build a canvas in the same coordinate system as the paper area.
// Step 1: draw the image to a temp canvas (scaled down if huge)
const MAX_W = 1800;
const scale = Math.min(1, MAX_W / img.naturalWidth);
const tmp = document.createElement("canvas");
tmp.width = Math.round(img.naturalWidth * scale);
tmp.height = Math.round(img.naturalHeight * scale);
const tctx = tmp.getContext("2d", { willReadFrequently:true });
tctx.drawImage(img, 0, 0, tmp.width, tmp.height);

// Step 2: auto-crop to content (removes browser UI / margins)
const cropped = cropToContent(tmp);

// Step 3: map to the paper coordinate system
const paper = document.getElementById("paper");
const rect = paper.getBoundingClientRect();
const w = Math.round(rect.width);
const h = Math.round(rect.height);

const canvas = document.createElement("canvas");
canvas.width = w;
canvas.height = h;
const ctx = canvas.getContext("2d", { willReadFrequently:true });

// Keep aspect ratio: fit cropped image inside paper
ctx.fillStyle = "white";
ctx.fillRect(0,0,w,h);
const arImg = cropped.width / cropped.height;
const arPaper = w / h;

let dw, dh, dx, dy;
if(arImg > arPaper){
  dw = w;
  dh = Math.round(w / arImg);
  dx = 0;
  dy = Math.round((h - dh)/2);
}else{
  dh = h;
  dw = Math.round(h * arImg);
  dy = 0;
  dx = Math.round((w - dw)/2);
}
ctx.drawImage(cropped, 0, 0, cropped.width, cropped.height, dx, dy, dw, dh);

    const detected = detectCheckedCodesFromCanvas(canvas, paper);

    // Apply as "scan" sources
    const now = new Date().toISOString();
    setSelectedCodes(detected, "scan");
    codeMeta = {};
    for(const code of detected){
      codeMeta[code] = { by: user.initials, at: now, source: "scan" };
    }
    updateSelectedCodes();

    // Log scan apply
    const recExisting = activeId ? loadRecords().find(r => r.id === activeId) : null;
    const audit = Array.isArray(recExisting?.audit) ? [...recExisting.audit] : [];
    audit.push({
      at: now,
      by: user.initials,
      action: "OCR_APPLY",
      detectedCount: detected.length,
      detected,
    });

    // Merge audit into current record (without forcing save)
    if(activeId && recExisting){
      recExisting.audit = audit;
      recExisting.selectedCodes = getSelectedCodes();
      recExisting.codeSources = {...codeSource};
      recExisting.codeMeta = {...codeMeta};
      recExisting.editedBy = user.initials;
      recExisting.updatedAt = now;
      upsertRecord(recExisting);
      renderRecordList();

      // OCR handler already persisted this record update
      changeBuffer = [];
    }

    alert(`OCR færdig: fandt ${detected.length} markerede felter.\nTjek resultatet og ret manuelt hvis nødvendigt.`);
  }catch(err){
    alert("OCR fejlede: " + (err?.message ?? err));
  }finally{
    scanFile.value = "";
  }
});


function loadImageFromFile(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Auto-crop: find bounding box of non-white pixels (ink) and crop with padding.
 * This helps a LOT when the image includes browser UI / margins, or when the scan has borders.
 */
function cropToContent(srcCanvas){
  const ctx = srcCanvas.getContext("2d", { willReadFrequently:true });
  const { width, height } = srcCanvas;
  const data = ctx.getImageData(0,0,width,height).data;

  const WHITE_LUM = 245;   // treat near-white as background
  const STRIDE = 2;        // speed vs accuracy (2 = sample every other pixel)
  let minX = width, minY = height, maxX = -1, maxY = -1;

  for(let y=0;y<height;y+=STRIDE){
    for(let x=0;x<width;x+=STRIDE){
      const i = (y*width + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const lum = 0.2126*r + 0.7152*g + 0.0722*b;
      if(lum < WHITE_LUM){
        if(x < minX) minX = x;
        if(y < minY) minY = y;
        if(x > maxX) maxX = x;
        if(y > maxY) maxY = y;
      }
    }
  }

  // If we didn't find content, return original
  if(maxX < 0) return srcCanvas;

  // Pad
  const pad = Math.round(Math.min(width, height) * 0.02) + 12; // dynamic + fixed
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width-1, maxX + pad);
  maxY = Math.min(height-1, maxY + pad);

  const cw = Math.max(1, maxX - minX + 1);
  const ch = Math.max(1, maxY - minY + 1);

  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const octx = out.getContext("2d", { willReadFrequently:true });
  octx.drawImage(srcCanvas, minX, minY, cw, ch, 0, 0, cw, ch);

  return out;
}

function avgLum(ctx, x, y, w, h){
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const img = ctx.getImageData(x, y, w, h).data;
  let sum = 0;
  for(let i=0;i<img.length;i+=4){
    const lum = 0.2126*img[i] + 0.7152*img[i+1] + 0.0722*img[i+2];
    sum += lum;
  }
  return sum / (img.length/4);
}

/**
 * Detect if a checkbox is marked by comparing darkness in its center vs nearby background.
 * This is more robust than a fixed threshold.
 */
function detectCheckedCodesFromCanvas(canvas, paperEl){
  const ctx = canvas.getContext("2d", { willReadFrequently:true });

  const cbs = Array.from(paperEl.querySelectorAll(".cb"));
  const pr = paperEl.getBoundingClientRect();

  const detected = [];
  const CENTER_SIZE = 12;  // sample area size (px)
  const OUT_SIZE = 12;
  const OUT_DIST = 18;     // how far from center to sample "background"
  const DELTA = 14;        // sensitivity: higher = fewer checks, lower = more checks

  for(const cb of cbs){
    const r = cb.getBoundingClientRect();

    const cx = (r.left - pr.left) + r.width/2;
    const cy = (r.top  - pr.top)  + r.height/2;

    const centerAvg = avgLum(ctx, cx - CENTER_SIZE/2, cy - CENTER_SIZE/2, CENTER_SIZE, CENTER_SIZE);

    // sample background around checkbox (4 directions)
    const out1 = avgLum(ctx, cx - OUT_SIZE/2, cy - OUT_SIZE/2 - OUT_DIST, OUT_SIZE, OUT_SIZE);
    const out2 = avgLum(ctx, cx - OUT_SIZE/2, cy - OUT_SIZE/2 + OUT_DIST, OUT_SIZE, OUT_SIZE);
    const out3 = avgLum(ctx, cx - OUT_SIZE/2 - OUT_DIST, cy - OUT_SIZE/2, OUT_SIZE, OUT_SIZE);
    const out4 = avgLum(ctx, cx - OUT_SIZE/2 + OUT_DIST, cy - OUT_SIZE/2, OUT_SIZE, OUT_SIZE);
    const outAvg = (out1 + out2 + out3 + out4) / 4;

    // If center is significantly darker than nearby background -> marked
    if((outAvg - centerAvg) > DELTA){
      detected.push(cb.dataset.code);
    }
  }

  return detected.sort((a,b)=>parseInt(a,10)-parseInt(b,10));
}



// ---------- Login modal wiring ----------
const loginModal = document.getElementById("loginModal");
const btnLogin = document.getElementById("btnLogin");
const btnLoginClose = document.getElementById("btnLoginClose");
const btnLoginSave = document.getElementById("btnLoginSave");
const btnLogout = document.getElementById("btnLogout");
const loginInitials = document.getElementById("loginInitials");
const loginPin = document.getElementById("loginPin");

function openLogin(){
  const user = getCurrentUser();
  loginInitials.value = user?.initials ?? "";
  if(loginPin) loginPin.value = "";
  loginModal.setAttribute("aria-hidden", "false");
}
function closeLogin(){
  loginModal.setAttribute("aria-hidden", "true");
}

btnLogin.addEventListener("click", () => {
  const user = getCurrentUser();
  if(user && confirm(`Log ud som ${user.initials}?`)){
    clearAuth();
    // For cloud-mode: tøm cache så listen er neutral indtil næste login
    if(USE_CLOUD){ recordsCache = []; renderRecordList(); }
    return;
  }
  openLogin();
});

btnLoginClose.addEventListener("click", closeLogin);
loginModal.querySelector(".modal__backdrop").addEventListener("click", closeLogin);

btnLoginSave.addEventListener("click", async () => {
  const initials = (loginInitials.value || "").trim().toUpperCase();
  const pin = (loginPin?.value || "").trim();

  if(!initials){
    alert("Skriv initialer (fx NIJEY).");
    return;
  }
  if(USE_CLOUD){
    if(!/^\d{4,8}$/.test(pin)){
      alert("PIN skal være 4–8 cifre.");
      return;
    }
    try{
      const data = await cloudLogin(initials, pin);
      setAuth({ token: data.token, user: { initials: data.initials, role: data.role } });
      closeLogin();
      await refreshRecords();
      alert("Logget ind (cloud).");
    }catch(err){
      alert("Login fejlede: " + (err?.message ?? err));
    }
  }else{
    // Lokal fallback: gem kun initialer (ingen rigtig sikkerhed)
    localStorage.setItem(USER_KEY, JSON.stringify({ initials, role: "user" }));
    setAuth({ token: null, user: { initials, role: "user" } });
    closeLogin();
    renderRecordList();
    alert("Logget ind (lokal).");
  }
});

btnLogout.addEventListener("click", async () => {
  clearAuth();
  closeLogin();
  if(USE_CLOUD){
    recordsCache = [];
    renderRecordList();
  }
});

// Admin: create user
const btnAdminCreateUser = document.getElementById("btnAdminCreateUser");
if(btnAdminCreateUser){
  btnAdminCreateUser.addEventListener("click", async () => {
    const user = getCurrentUser();
    if(!user || user.role !== "admin"){
      alert("Kun admin kan oprette brugere.");
      return;
    }
    const initials = prompt("Initialer på ny bruger (fx AB):", "")?.trim().toUpperCase();
    if(!initials) return;

    const pin = prompt("PIN (4-8 cifre) til brugeren:", "")?.trim();
    if(!pin) return;

    const role = (prompt("Role (user/admin):", "user") || "user").trim().toLowerCase() === "admin" ? "admin" : "user";

    try{
      await cloudCreateUser(initials, pin, role);
      alert(`Bruger ${initials} oprettet/opdateret (${role}).`);
    }catch(err){
      alert("Kunne ikke oprette bruger: " + (err?.message ?? err));
    }
  });
}


// ---------- Buttons ----------
el("btnNew").addEventListener("click", clearForm);

el("btnSave").addEventListener("click", async () => {
  const user = requireLogin("Du skal være logget ind for at kunne gemme (så vi kan logge initialer).");
  if(!user) return;

  const rec = getFormData();
  try{
    await upsertRecord(rec);
    activeId = rec.id;
    renderRecordList();
    changeBuffer = [];

    // Audit: gem-hændelse
    await logAudit({
      action: "SAVE",
      record_id: rec.id,
      hovednr: rec.hovedkomponentnr || null,
      meta: { selectedCount: (rec.selectedCodes||[]).length }
    });

    alert(USE_CLOUD ? "Gemt (cloud)." : "Gemt lokalt.");
  }catch(err){
    alert("Kunne ikke gemme: " + (err?.message ?? err));
  }
});

el("btnLoad").addEventListener("click", async () => {
  if(USE_CLOUD){
    try{
      await refreshRecords();
    }catch(err){
      alert("Kunne ikke hente cloud-poster: " + (err?.message ?? err));
      return;
    }
  }
  const records = loadRecords();
  if(records.length === 0){
    alert("Ingen gemte poster.");
    return;
  }
  setFormData(records[0]); // newest
  renderRecordList();
});


// ---------- Excel export (XLSX) ----------
function exportExcelFromCurrent(){
  const main = (fields.main.value || "").trim();
  const desc = (fields.desc.value || "").trim();
  const plant = (fields.plant.value || "").trim();
  const pid = (fields.pid.value || "").trim();
  const signHeader = [ (fields.sign1.value||"").trim(), (fields.sign2.value||"").trim() ].filter(Boolean).join("; ");

  const codes = getSelectedCodes();
  if(!main){
    alert("Udfyld først 'Hovedkomponentnr.' før eksport.");
    return;
  }
  if(typeof XLSX === "undefined"){
    alert("Excel-biblioteket (XLSX) er ikke indlæst. Tjek internetforbindelse eller CDN-link i index.html.");
    return;
  }
  if(codes.length === 0){
    alert("Der er ingen krydser valgt at eksportere.");
    return;
  }

  const rows = codes.map(code => {
    const meta = codeMeta?.[code];
    const signature = meta?.by || signHeader || "—";
    const tag = `${main}.${code}`;
    return {
      "Hovedkomponentnr.": main,
      "Beskrivelse": desc,
      "Anlæg": plant,
      "PID Tegningsnr.": pid,
      "Signatur": signature,
      "Opsætning": code,
      "Tag": tag,
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: [
    "Hovedkomponentnr.",
    "Beskrivelse",
    "Anlæg",
    "PID Tegningsnr.",
    "Signatur",
    "Opsætning",
    "Tag",
  ]});
  // Make columns a bit wider
  ws["!cols"] = [
    { wch: 18 },
    { wch: 40 },
    { wch: 16 },
    { wch: 18 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Komponenter");

  const today = new Date();
  const y = String(today.getFullYear());
  const m = String(today.getMonth()+1).padStart(2,"0");
  const d = String(today.getDate()).padStart(2,"0");
  const safeMain = main.replace(/[^a-z0-9\-_.]+/gi,"_");
  const filename = `komponent-blanket_${safeMain}_${y}-${m}-${d}.xlsx`;

  XLSX.writeFile(wb, filename);
}


el("btnPrint").addEventListener("click", () => window.print());

el("btnExport").addEventListener("click", async () => {
  if(USE_CLOUD){
    try{ await refreshRecords(); }catch{}
  }
  const records = loadRecords();
  const blob = new Blob([JSON.stringify(records, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "komponent-blanketter.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

el("btnExportExcel").addEventListener("click", exportExcelFromCurrent);

searchEl.addEventListener("input", renderRecordList);

// Initialize
(function init(){
  // Label UI depending on mode
  const btnSave = el("btnSave");
  const btnLoad = el("btnLoad");
  const title = document.querySelector(".sidebar__title");
  const hint = document.querySelector(".hint");

  if(USE_CLOUD){
    if(btnSave) btnSave.textContent = "Gem (cloud)";
    if(btnLoad) btnLoad.textContent = "Hent (cloud)";
    if(title) title.textContent = "Poster (cloud)";
    if(hint){
      hint.innerHTML = `
        <div><strong>Cloud-mode:</strong> Poster gemmes i D1 (fælles for alle brugere).</div>
        <div>Log ind for at se og redigere poster.</div>
      `;
    }
  }else{
    if(btnSave) btnSave.textContent = "Gem lokalt";
    if(btnLoad) btnLoad.textContent = "Hent lokalt";
    if(title) title.textContent = "Poster (lokalt)";
  }

  updateUserBadge();
  updateSelectedCodes();

  if(USE_CLOUD && getCurrentUser()){
    refreshRecords().catch(() => renderRecordList());
  }else{
    renderRecordList();
  }
})();
