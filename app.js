// Simple local-only "app" to match the scanned UX.
// - Builds checkbox grids for the ranges
// - Shows selected codes
// - Saves/loads multiple records to localStorage
// - Exports JSON
//
// No backend required.

const STORAGE_KEY = "componentFormRecords_v1";
const DRAFT_KEY = "componentFormDraft_v1";


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
const availableCodesEl = el("availableCodes");
const availCountEl = el("availCount");
const matrixCandidatesEl = el("matrixCandidates");
const suffixInputEl = el("suffixInput");
const suffixSeriesEl = el("suffixSeries");
const recordListEl = el("recordList");
const searchEl = el("search");
const searchResultCountEl = el("searchResultCount");
const searchModeHintEl = el("searchModeHint");

// Sidebar multi-select + export
const btnSelectAllVisible = document.getElementById("btnSelectAllVisible");
const btnSelectNone = document.getElementById("btnSelectNone");
const btnExportExcelSelected = document.getElementById("btnExportExcelSelected");
const btnPrintSelected = document.getElementById("btnPrintSelected");
const btnNewSide = document.getElementById("btnNewSide");
const selectedRecordCountEl = document.getElementById("selectedRecordCount");

let selectedRecordIds = new Set();

let activeId = null;
let loadedRecordUpdatedAt = null;
// codeSource: {'01':'scan'|'manual'} for currently checked codes
let codeSource = {};
// codeMeta: {'01': {by:'AB', at:'ISO', source:'manual'|'scan'}} for currently checked codes
let codeMeta = {};
// buffer of unsaved fine-grained changes (checkbox clicks etc.)
let changeBuffer = [];
let autoSaveTimer = null;
let autoSaveInFlight = false;
let autoSaveQueued = false;

// ---------- Build checkbox grids ----------
function parseRange(rangeStr){
  const [a,b] = rangeStr.split("-").map(s=>parseInt(s.trim(),10));
  return {a,b};
}
function pad2(n){ return String(n).padStart(2,"0"); }

function parseSuffixInput(v){
  const raw = String(v || "").trim();
  if(!raw) return null;
  const n = parseInt(raw, 10);
  if(!Number.isFinite(n) || n < 1 || n > 99) return null;
  return n;
}

function compressRanges(nums){
  const arr = (nums || []).slice().sort((a,b)=>a-b);
  const out = [];
  let start = null;
  let prev = null;

  for(const n of arr){
    if(start === null){ start = n; prev = n; continue; }
    if(n === prev + 1){ prev = n; continue; }
    out.push([start, prev]);
    start = n; prev = n;
  }
  if(start !== null) out.push([start, prev]);
  return out;
}


// ---------- Nummerstatus + Serie (0xx..9xx) ----------
let currentMark = "blue";   // "blue" | "reserved" | "red"
let currentSeries = 0;      // 0..9 (0xx, 1xx, ...)
let currentFilter = "all"; // "all" | "blue" | "reserved" | "red" | "scan"

// Suffix-overblik (01-99) på tværs af serier
let currentSuffix = null; // number 1..99

// PID-valg (hvis fPid indeholder flere PID-numre, kan hvert tag knyttes til en PID)
let pidOptions = [];        // fx ["1751","3503"]
let currentPidIdx = 0;      // 0..pidOptions.length-1

function getSeriesOffset(){ return currentSeries * 100; }

function displayNumberForSeries(i){
  const off = getSeriesOffset();
  return off === 0 ? pad2(i) : String(off + i);
}

function codeKeyForSeries(i){
  // Internal code key used in state / export (01-99 or 101-199 etc.)
  const off = getSeriesOffset();
  return off === 0 ? pad2(i) : String(off + i);
}

function codeKeyForExplicitSeries(series, suffix){
  const s = Math.max(0, Math.min(9, parseInt(series, 10) || 0));
  const n = Math.max(1, Math.min(99, parseInt(suffix, 10) || 0));
  return s === 0 ? pad2(n) : String(s * 100 + n);
}

function updateRangeLabels(){
  const off = getSeriesOffset();
  const fmt = (n) => (off === 0 && n < 100) ? pad2(n) : String(n);

  document.querySelectorAll(".section").forEach(sec => {
    const grid = sec.querySelector(".grid");
    const span = sec.querySelector(".secRange");
    if(!grid || !span) return;

    const {a,b} = parseRange(grid.dataset.range);
    const A = off + a;
    const B = off + b;
    span.textContent = `${fmt(A)} - ${fmt(B)}`;
  });
}

function parsePidList(raw){
  const s = String(raw || "");
  // Find typisk 3-6 cifre PID-numre (fx 1751;3503)
  const nums = s.match(/\b\d{3,6}\b/g) || [];
  const uniq = [];
  for(const n of nums){
    const t = String(n).trim();
    if(t && !uniq.includes(t)) uniq.push(t);
  }
  return uniq;
}

function getCurrentPidValue(){
  if(!pidOptions.length) return null;
  const idx = Math.max(0, Math.min(pidOptions.length-1, currentPidIdx));
  return pidOptions[idx] || pidOptions[0] || null;
}

function getCurrentPidColorIdx(){
  return (pidOptions.length > 1) ? (Math.max(0,currentPidIdx) % 4) : null;
}

function setPidIndex(idx){
  const i = Math.max(0, Math.min((pidOptions.length||1)-1, parseInt(idx,10)||0));
  currentPidIdx = i;
  renderPidSeg();
  updateSelectedCodes();
}

function renderPidSeg(){
  const wrap = document.getElementById("pidToolgroup");
  const seg = document.getElementById("pidSeg");
  if(!wrap || !seg) return;

  if(pidOptions.length <= 1){
    wrap.style.display = "none";
    seg.innerHTML = "";
    currentPidIdx = 0;
    return;
  }

  wrap.style.display = "flex";
  seg.innerHTML = pidOptions.map((pid, idx) => {
    const active = idx === currentPidIdx;
    const dot = `<span class="pidDot" data-pid="${idx % 4}"></span>`;
    return `<button class="segBtn ${active ? "segBtn--active" : ""}" data-pid-idx="${idx}" type="button">${dot}${pid}</button>`;
  }).join("");

  seg.querySelectorAll(".segBtn").forEach(btn => {
    btn.addEventListener("click", () => setPidIndex(btn.dataset.pidIdx));
  });
}

function refreshPidOptionsFromField(){
  const list = parsePidList(fields.pid.value);
  pidOptions = list;
  if(currentPidIdx >= pidOptions.length) currentPidIdx = 0;
  // Ret evt. allerede valgte tags, hvis de har en PID der ikke længere findes
  const fallback = getCurrentPidValue();
  for(const code of Object.keys(codeMeta || {})){
    const meta = codeMeta[code] || {};
    if(pidOptions.length > 1){
      if(meta.pid && !pidOptions.includes(meta.pid)){
        codeMeta[code] = { ...meta, pid: fallback, pidIdx: currentPidIdx, pidColor: (currentPidIdx % 4) };
      }
    }else{
      // single/no PID: ryd PID-indikator i UI (men behold evt. pid i data)
      codeMeta[code] = { ...meta, pid: pidOptions[0] || meta.pid || null, pidIdx: 0, pidColor: 0 };
    }
  }
  renderPidSeg();
  updateSelectedCodes();
}

function parseMainNumber(raw){
  const s = String(raw || "").trim();
  if(!s) return "";
  // Prefer digits at start (fx "00075 nr. 01-99")
  const m1 = s.match(/^\s*(\d{1,10})/);
  if(m1) return m1[1];
  // Fallback: first digit group anywhere
  const m2 = s.match(/\b(\d{1,10})\b/);
  return m2 ? m2[1] : "";
}

function stripLeadingZeros(numStr){
  const s = String(numStr || "");
  if(!s) return "";
  const n = parseInt(s, 10);
  if(!Number.isFinite(n)) return s.replace(/^0+(?=\d)/, "");
  return String(n);
}

function validateSingleMainNumber(raw){
  const s = String(raw || "").trim();
  if(!s) return { ok:false, message:"Udfyld 'Hovedkomponentnr.' (fx 00075)." };

  // Find 'hovednumre' som 4+ cifre (så 01-99 og 101-199 ikke tæller med)
  const groups = [...s.matchAll(/\b\d{4,10}\b/g)].map(m => m[0]);

  // Hvis brugeren kun har et 'kort' hovednr (fx 575), kan vi ikke robust skelne det fra 101/199,
  // så vi tjekker kun 4+ cifre for at undgå falske positiver.
  if(groups.length <= 1) return { ok:true };

  const first = stripLeadingZeros(groups[0]);
  const others = groups.slice(1).map(stripLeadingZeros).filter(x => x && x !== first);
  const uniq = [...new Set([first, ...others])];

  if(uniq.length > 1){
    return {
      ok:false,
      message:`Feltet 'Hovedkomponentnr.' indeholder flere hovednumre (${uniq.join(", ")}). Brug kun ét hovednummer.`
    };
  }

  return { ok:true };
}

function formatOpsaetning(code){
  const n = parseInt(code, 10);
  if(Number.isFinite(n) && n >= 0 && n < 100) return pad2(n);
  return String(code);
}

function buildTag(mainRaw, code){
  const main = parseMainNumber(mainRaw);
  const mainTag = stripLeadingZeros(main);
  const ops = formatOpsaetning(code);
  return mainTag ? `${mainTag}.${ops}` : "";
}

// Same tag format, but keeps leading zeros in the main number (useful for search/display)
function buildTagKeepZeros(mainRaw, code){
  const main = parseMainNumber(mainRaw);
  const ops = formatOpsaetning(code);
  return main ? `${main}.${ops}` : "";
}

// Parse a tag string like '4390.002' or '27.530' into {mainRaw, codeKey}
// codeKey matches the app's internal key format: '02' (01-99) or '530' (100-999)
function parseTagString(tagStr){
  const t = String(tagStr || '').trim();
  if(!t) return null;
  const m = t.match(/^\s*(\d{1,10})\s*\.\s*(\d{1,10})\s*$/);
  if(!m) return null;

  const mainRaw = m[1];
  const codeRaw = m[2];
  const codeNum = parseInt(codeRaw, 10);
  if(!Number.isFinite(codeNum)) return null;

  // 01-99 (0xx)
  if(codeNum >= 1 && codeNum <= 99){
    return { mainRaw, codeKey: pad2(codeNum) };
  }

  // 101-999 (1xx..9xx)
  if(codeNum >= 100 && codeNum <= 999){
    const series = Math.floor(codeNum / 100);
    const suffix = codeNum % 100;
    if(series < 1 || series > 9) return null;
    if(suffix < 1 || suffix > 99) return null;
    return { mainRaw, codeKey: String(codeNum) };
  }

  return null;
}

function normalizeMainKey(mainRaw){
  return stripLeadingZeros(parseMainNumber(mainRaw));
}

const TAG_STATUS = {
  ACTIVE: "blue",
  RESERVED: "reserved",
  RELEASED: "red",
};

function normalizeTagStatus(mark){
  const raw = String(mark || TAG_STATUS.ACTIVE).trim().toLowerCase();
  if(raw === TAG_STATUS.RESERVED || raw === "project" || raw === "temporary") return TAG_STATUS.RESERVED;
  if(raw === TAG_STATUS.RELEASED || raw === "free" || raw === "removed") return TAG_STATUS.RELEASED;
  // Legacy green scan marks are treated as active tags with scan/import as source.
  return TAG_STATUS.ACTIVE;
}

function tagStatusLabel(mark){
  const status = normalizeTagStatus(mark);
  if(status === TAG_STATUS.RESERVED) return "Projekt";
  if(status === TAG_STATUS.RELEASED) return "Frigivet";
  return "I brug";
}

function tagStatusSymbol(mark){
  const status = normalizeTagStatus(mark);
  if(status === TAG_STATUS.RESERVED) return "🟠";
  if(status === TAG_STATUS.RELEASED) return "🔴";
  return "🔵";
}

function isBlockingStatus(mark){
  const status = normalizeTagStatus(mark);
  return status === TAG_STATUS.ACTIVE || status === TAG_STATUS.RESERVED;
}

function isScanSourceValue(source, mark){
  return source === "scan" || mark === "scan";
}

function markSymbol(mark){
  return tagStatusSymbol(mark);
}

function getRecMark(rec, code){
  if(!rec) return TAG_STATUS.ACTIVE;
  const src = rec.codeSources || {};
  const meta = rec.codeMeta || {};
  return normalizeTagStatus(meta?.[code]?.mark || TAG_STATUS.ACTIVE);
}

function isRecScanSource(rec, code){
  if(!rec) return false;
  const src = rec.codeSources || {};
  const meta = rec.codeMeta || {};
  return isScanSourceValue(src?.[code], meta?.[code]?.source || meta?.[code]?.mark);
}

function getRecPid(rec, code){
  if(!rec) return null;
  return (rec.codeMeta && rec.codeMeta[code] && rec.codeMeta[code].pid) ? String(rec.codeMeta[code].pid) : null;
}

function formatChangeItem(tag, mark, pid, showPid){
  const m = markSymbol(mark);
  const p = (showPid && pid) ? ` [${pid}]` : "";
  return `${tag}${m}${p}`;
}

function todayDateInputValue(date = new Date()){
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function normalizeDateInputValue(value){
  const raw = String(value || "").trim();
  if(!raw) return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const m = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if(!m) return "";

  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if(!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return "";

  const d = new Date(Date.UTC(year, month - 1, day));
  if(d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return "";
  return `${String(year).padStart(4,"0")}-${pad2(month)}-${pad2(day)}`;
}

function formatDateValue(value){
  const normalized = normalizeDateInputValue(value);
  if(!normalized) return String(value || "").trim();
  const [year, month, day] = normalized.split("-");
  return `${day}.${month}.${year}`;
}

function setDateFieldValue(field, value, fallbackToday = false){
  if(!field) return;
  const raw = String(value || "").trim();
  const normalized = normalizeDateInputValue(raw);
  if(normalized){
    field.value = normalized;
    delete field.dataset.legacyValue;
    field.removeAttribute("title");
    return;
  }

  field.value = fallbackToday ? todayDateInputValue() : "";
  if(raw){
    field.dataset.legacyValue = raw;
    field.title = `Tidligere værdi: ${raw}`;
  }else{
    delete field.dataset.legacyValue;
    field.removeAttribute("title");
  }
}

function getDateFieldValue(field){
  if(!field) return "";
  return field.value || field.dataset.legacyValue || "";
}

function transitionLabel(fromMark, toMark){
  const from = normalizeTagStatus(fromMark);
  const to = normalizeTagStatus(toMark);
  if(from === TAG_STATUS.RESERVED && to === TAG_STATUS.RELEASED) return "Projekt frigivet";
  if(from === TAG_STATUS.RELEASED && to === TAG_STATUS.RESERVED) return "Frigivet tilbage til projekt";
  if(from === TAG_STATUS.RELEASED && to === TAG_STATUS.ACTIVE) return "Frigivet sat i brug";
  if(from === TAG_STATUS.ACTIVE && to === TAG_STATUS.RELEASED) return "I brug markeret frigivet";
  if(to === TAG_STATUS.RELEASED) return "Frigivet";
  return `Status ændret (${tagStatusLabel(from)} → ${tagStatusLabel(to)})`;
}

function addedChangeLabel(mark){
  const status = normalizeTagStatus(mark);
  if(status === TAG_STATUS.RESERVED) return "Projekt reserveret";
  if(status === TAG_STATUS.RELEASED) return "Frigivet markeret";
  return "Sat i brug";
}

function removedChangeLabel(mark){
  const status = normalizeTagStatus(mark);
  if(status === TAG_STATUS.RESERVED) return "Projekt fjernet";
  if(status === TAG_STATUS.RELEASED) return "Frigivet fjernet";
  return "I brug fjernet";
}

function computeTagChanges(prevRec, currRec){
  if(!currRec) return "";
  const main = currRec.hovedkomponentnr || "";
  const showPid = (parsePidList(currRec.pid || "").length > 1);

  const prevSel = new Set(prevRec?.selectedCodes || []);
  const currSel = new Set(currRec.selectedCodes || []);

  const addedByLabel = new Map();
  const removedByLabel = new Map();
  const changed = [];
  const changedByLabel = new Map();

  const pushGrouped = (map, label, value) => {
    if(!map.has(label)) map.set(label, []);
    map.get(label).push(value);
  };
  const pushChanged = (label, value) => {
    pushGrouped(changedByLabel, label, value);
  };

  // Added & changed
  for(const code of currRec.selectedCodes || []){
    if(!prevSel.has(code)){
      const tag = buildTag(main, code);
      const mark = getRecMark(currRec, code);
      pushGrouped(addedByLabel, addedChangeLabel(mark), formatChangeItem(tag, mark, getRecPid(currRec, code), showPid));
    }else{
      // present in both: check mark/pid changes
      const m0 = getRecMark(prevRec, code);
      const m1 = getRecMark(currRec, code);
      const p0 = getRecPid(prevRec, code);
      const p1 = getRecPid(currRec, code);

      const tag = buildTag(main, code);
      const parts = [];

      if(m0 !== m1){
        pushChanged(transitionLabel(m0, m1), `${tag} ${markSymbol(m0)}→${markSymbol(m1)}`);
      }
      if(showPid && (p0 || p1) && (String(p0||"") !== String(p1||""))){
        parts.push(`[${p0||"—"}→${p1||"—"}]`);
      }
      if(parts.length){
        changed.push(`${tag} ${parts.join(" ")}`);
      }
    }
  }

  // Removed
  for(const code of (prevRec?.selectedCodes || [])){
    if(!currSel.has(code)){
      const tag = buildTag(main, code);
      const mark = getRecMark(prevRec, code);
      pushGrouped(removedByLabel, removedChangeLabel(mark), formatChangeItem(tag, mark, getRecPid(prevRec, code), showPid));
    }
  }

  if(!prevRec){
    const addedLines = [...addedByLabel.entries()].map(([label, items]) => `${label}: ${items.join(", ")}`);
    if(!addedLines.length) return "Oprettet (ingen tags valgt).";
    return `Oprettet\n${addedLines.join("\n")}`;
  }

  const lines = [];
  for(const [label, items] of addedByLabel.entries()){
    lines.push(`${label}: ${items.join(", ")}`);
  }
  for(const [label, items] of removedByLabel.entries()){
    lines.push(`${label}: ${items.join(", ")}`);
  }
  for(const [label, items] of changedByLabel.entries()){
    lines.push(`${label}: ${items.join(", ")}`);
  }
  if(changed.length) lines.push(`Ændret: ${changed.join(", ")}`);
  if(!lines.length) return "Ingen tag-ændringer.";
  return lines.join("\n");
}


function getMarkForCode(code){
  const src = codeSource[code] || "manual";
  const meta = codeMeta?.[code] || {};
  return normalizeTagStatus(meta.mark || TAG_STATUS.ACTIVE);
}

function isScanSourceForCode(code){
  const src = codeSource[code] || "manual";
  const meta = codeMeta?.[code] || {};
  return isScanSourceValue(src, meta.source || meta.mark);
}

function setMarkMode(mark){
  currentMark = normalizeTagStatus(mark);
  const seg = document.getElementById("markSeg");
  if(seg){
    seg.querySelectorAll(".segBtn").forEach(btn => {
      btn.classList.toggle("segBtn--active", btn.dataset.mark === currentMark);
    });
  }
}

function setSeries(series){
  const s = Math.max(0, Math.min(9, parseInt(series, 10) || 0));
  currentSeries = s;

  // CSS helper (bedre spacing i 1xx..9xx)
  try{ document.documentElement.dataset.series = String(currentSeries); }catch{}

  const seg = document.getElementById("seriesSeg");
  if(seg){
    seg.querySelectorAll(".segBtn").forEach(btn => {
      btn.classList.toggle("segBtn--active", parseInt(btn.dataset.series,10) === currentSeries);
    });
  }

  updateRangeLabels();

  rebuildGrids();
}

function setFilterMode(filter){
  const f = String(filter || "all");
  const allowed = new Set(["all","blue","reserved","red","scan"]);
  currentFilter = allowed.has(f) ? f : "all";

  const seg = document.getElementById("filterSeg");
  if(seg){
    seg.querySelectorAll(".segBtn").forEach(btn => {
      btn.classList.toggle("segBtn--active", btn.dataset.filter === currentFilter);
    });
  }

  updateSelectedCodes();
}

function rebuildGrids(){
  document.querySelectorAll(".grid").forEach(buildGrid);
  // Ensure newly built checkboxes follow the current access level.
  setEditingEnabled();
  updateSelectedCodes();
}

function clearSeriesCodes(series){
  const s = Math.max(0, Math.min(9, parseInt(series, 10) || 0));
  const min = s * 100 + 1;
  const max = s * 100 + 99;

  for(const code of Object.keys(codeSource || {})){
    const n = parseInt(code, 10);
    if(Number.isFinite(n) && n >= min && n <= max){
      delete codeSource[code];
      delete codeMeta[code];
    }
  }
}


// ---------- Auth + API (Cloudflare backend) ----------
// Hvis window.COMPONENT_APP_API (i index.html) er sat, kører app'en i cloud-mode.
// Ellers falder den tilbage til lokal/offline mode (localStorage).
const AUTH_KEY = "componentFormAuth_v2";
const API_BASE = (window.COMPONENT_APP_API || "").trim().replace(/\/+$/,"");
const USE_CLOUD = !!API_BASE;
const ROLE_USER = "user";
const ROLE_ALLOCATOR = "allocator";
const ROLE_ADMIN = "admin";

// Local fallback storage key (bruges kun hvis USE_CLOUD=false)
const USER_KEY = "componentFormUser_v1"; // legacy key for backward compatibility

function normalizeRole(role){
  const raw = String(role || ROLE_USER).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if(raw === ROLE_ADMIN) return ROLE_ADMIN;
  if(["allocator", "planner", "semi_admin", "semiadmin", "editor", "manager"].includes(raw)) return ROLE_ALLOCATOR;
  return ROLE_USER;
}

function roleLabel(role){
  const r = normalizeRole(role);
  if(r === ROLE_ADMIN) return "admin";
  if(r === ROLE_ALLOCATOR) return "planner";
  return "visning";
}

function canAllocateNumbers(user = getCurrentUser()){
  const role = normalizeRole(user?.role);
  return role === ROLE_ADMIN || role === ROLE_ALLOCATOR;
}

function isPlannerOnly(user = getCurrentUser()){
  return normalizeRole(user?.role) === ROLE_ALLOCATOR;
}

function canManageUsers(user = getCurrentUser()){
  return normalizeRole(user?.role) === ROLE_ADMIN;
}

function canCreateRecords(user = getCurrentUser()){
  const role = normalizeRole(user?.role);
  return role === ROLE_ADMIN || role === ROLE_ALLOCATOR;
}

function canImportData(user = getCurrentUser()){
  return canManageUsers(user);
}

function canScanPaper(user = getCurrentUser()){
  return canManageUsers(user);
}

function canExportBackup(user = getCurrentUser()){
  return canManageUsers(user);
}

function canSaveRecords(user = getCurrentUser()){
  const role = normalizeRole(user?.role);
  return role === ROLE_ADMIN || role === ROLE_ALLOCATOR;
}

function canUseStatus(mark, user = getCurrentUser()){
  const status = normalizeTagStatus(mark);
  if(canManageUsers(user)) return true;
  return isPlannerOnly(user) && status === TAG_STATUS.RESERVED;
}

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
  if(auth?.user) auth.user.role = normalizeRole(auth.user.role);
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  updateUserBadge();
}

function clearAuth(){
  localStorage.removeItem(AUTH_KEY);
  updateUserBadge();
}

function getCurrentUser(){
  const auth = getAuth();
  if(!auth?.user) return null;
  return { ...auth.user, role: normalizeRole(auth.user.role) };
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
    const err = new Error(msg || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function normalizeLoginInput(value){
  const raw = String(value || "").trim();
  if(raw.includes("@")) return raw.toLowerCase();
  return raw.toUpperCase();
}

async function cloudLogin(login, pin){
  return apiFetch("/auth/login", {
    method: "POST",
    noAuth: true,
    body: JSON.stringify({ login, initials: login, password: pin, pin }),
  });
}

async function cloudMe(){
  return apiFetch("/auth/me", { method: "GET" });
}

async function cloudCreateUser(initials, pin, role="user", email=""){
  return apiFetch("/admin/users", {
    method: "POST",
    body: JSON.stringify({ initials, password: pin, pin, role: normalizeRole(role), email }),
  });
}

async function cloudListUsers(){
  return apiFetch("/admin/users", { method: "GET" });
}

function requireLogin(reason = "Du skal være logget ind for at kunne redigere."){
  const user = getCurrentUser();
  if(user) return user;
  alert(reason);
  openLogin();
  return null;
}

function requireAllocator(reason = "Du skal have planner eller admin adgang for at kunne reservere/gemme numre."){
  const user = requireLogin(reason);
  if(!user) return null;
  if(canSaveRecords(user)) return user;
  alert(reason);
  return null;
}

function requireAdmin(reason = "Du skal have admin adgang for at bruge denne funktion."){
  const user = requireLogin(reason);
  if(!user) return null;
  if(canManageUsers(user)) return user;
  alert(reason);
  return null;
}

function updateAuthGate(){
  const user = getCurrentUser();
  document.body.classList.toggle("is-authenticated", !!user);
}

function updateSyncBadge(message){
  const badge = document.getElementById("syncBadge");
  if(!badge) return;
  if(message){
    badge.textContent = message;
    return;
  }
  const user = getCurrentUser();
  badge.textContent = USE_CLOUD ? (user ? "Cloud synkroniseret" : "Login kræves") : "Lokal demo";
}

function updateUserBadge(){
  const badge = document.getElementById("userBadge");
  const loginBtn = document.getElementById("btnLogin");
  const user = getCurrentUser();
  updateAuthGate();
  updateSyncBadge();
  if(!badge) return;

  if(!user){
    badge.textContent = `Ikke logget ind`;
    badge.style.color = "var(--muted)";
    if(loginBtn) loginBtn.textContent = "Login";
    setEditingEnabled();
    updateAdminUi();
    return;
  }

  badge.textContent = `${user.initials} · ${roleLabel(user.role)}`;
  badge.style.color = "var(--accent-strong)";
  if(loginBtn) loginBtn.textContent = "Log ud";
  setEditingEnabled();
  updateAdminUi();
}

function updateAdminUi(){
  const btn = document.getElementById("btnAdminCreateUser");
  const user = getCurrentUser();
  if(!btn) return;
  const show = USE_CLOUD && user && canManageUsers(user);
  btn.style.display = show ? "inline-flex" : "none";
}

function setButtonAccess(id, visible, enabled = visible){
  const node = document.getElementById(id);
  if(!node) return;
  node.hidden = !visible;
  node.disabled = !enabled;
}

function updateTopbarGroups(){
  document.querySelectorAll(".topbar__group:not(.topbar__group--session)").forEach(group => {
    const hasVisibleButton = Array.from(group.querySelectorAll("button")).some(btn => !btn.hidden);
    group.hidden = !hasVisibleButton;
  });
}

function setEditingEnabled(){
  const user = getCurrentUser();
  const canMark = !!user && canAllocateNumbers(user);
  const admin = !!user && canManageUsers(user);
  const planner = !!user && isPlannerOnly(user);
  const canCreate = !!user && canCreateRecords(user);
  const canEditMaster = admin || (planner && !activeId);

  // Checkboxes
  getAllCheckboxes().forEach(cb => cb.disabled = !canMark);

  setButtonAccess("btnSave", !!user && canSaveRecords(user), !!user && canSaveRecords(user));
  setButtonAccess("btnNew", canCreate, canCreate);
  setButtonAccess("btnNewSide", canCreate, canCreate);
  setButtonAccess("btnOCR", admin && canScanPaper(user), admin && canScanPaper(user));
  setButtonAccess("btnImport", admin && canImportData(user), admin && canImportData(user));
  setButtonAccess("btnExport", admin && canExportBackup(user), admin && canExportBackup(user));
  setButtonAccess("btnExportExcel", !!user, !!user);
  setButtonAccess("btnPrint", !!user, !!user);
  setButtonAccess("btnLoad", !!user, !!user);

  const saveBtn = document.getElementById("btnSave");
  if(saveBtn) saveBtn.textContent = planner ? "Gem projekt" : "Gem ændringer";

  [fields.desc, fields.plant, fields.pid, fields.sign1, fields.sign2].forEach(field => {
    if(field) field.readOnly = !canEditMaster;
  });
  if(fields.main) fields.main.readOnly = !canEditMaster;

  document.querySelectorAll("#markSeg .segBtn").forEach(btn => {
    const status = btn.dataset.mark;
    const allowed = !!user && canUseStatus(status, user);
    btn.disabled = !allowed;
    if(planner && status === TAG_STATUS.RESERVED){
      btn.classList.add("segBtn--active");
    }
  });

  document.querySelectorAll("#pidSeg .segBtn").forEach(btn => {
    btn.disabled = !canMark;
  });

  if(planner) setMarkMode(TAG_STATUS.RESERVED);
  updateTopbarGroups();
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


function summarizeMarks(rec){
  let blue = 0, reserved = 0, red = 0, scan = 0;
  const sources = rec.codeSources || {};
  const meta = rec.codeMeta || {};
  (rec.selectedCodes || []).forEach(code => {
    const mark = normalizeTagStatus(meta?.[code]?.mark || TAG_STATUS.ACTIVE);
    if(mark === TAG_STATUS.RELEASED) red++;
    else if(mark === TAG_STATUS.RESERVED) reserved++;
    else blue++;
    if(isScanSourceValue(sources?.[code], meta?.[code]?.source || meta?.[code]?.mark)) scan++;
  });
  return {blue, reserved, red, scan};
}


function buildGrid(gridEl){
  const {a,b} = parseRange(gridEl.dataset.range);
  gridEl.innerHTML = "";

  // Special for 01-29 (samme layout i alle serier)
  if(a === 1 && b === 29){
    const spacer = document.createElement("div");
    spacer.className = "gridSpacer";
    gridEl.appendChild(spacer);
  }

  for(let i=a;i<=b;i++){
    const wrap = document.createElement("label");
    wrap.className = "item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "cb";

    const codeKey = codeKeyForSeries(i);
    cb.dataset.code = codeKey;

    // Initial state from memory (kan indeholde 0xx + 1xx + ...)
    cb.checked = !!codeSource[codeKey];
    cb.disabled = !canAllocateNumbers();

    // Right-click: force red mark without unchecking
    cb.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const user = getCurrentUser();
      if(!user){
        requireLogin("Du skal være logget ind for at kunne sætte krydser.");
        return;
      }
      if(!canManageUsers(user)){
        alert("Kun admin kan sætte I brug/frigivet direkte. Planner kan kun bruge Projekt-status.");
        return;
      }

      const now = new Date().toISOString();
      const wasChecked = cb.checked;

      if(!cb.checked){
        cb.checked = true;
        changeBuffer.push({ at: now, by: user.initials, action: "CHECK", code: codeKey, source: "manual", mark: "red" });
      }else{
        changeBuffer.push({ at: now, by: user.initials, action: "COLOR_CHANGE", code: codeKey, source: "manual", mark: "red" });
      }

      codeSource[codeKey] = "manual";
      codeMeta[codeKey] = {
        by: user.initials,
        at: now,
        source: "manual",
        mark: "red",
        pid: getCurrentPidValue(),
        pidIdx: currentPidIdx,
        pidColor: (pidOptions.length > 1) ? (currentPidIdx % 4) : 0,
      };

      updateSelectedCodes();
      saveDraft("status-change");
      scheduleAutoSave("status-change");

      const mainRaw = (fields.main.value || "").trim();
      logAudit({
        action: wasChecked ? "COLOR_CHANGE" : "CHECK",
        record_id: activeId,
        hovednr: parseMainNumber(mainRaw) || null,
        opsaetning: parseInt(codeKey, 10),
        tag: buildTag(mainRaw, codeKey) || null,
        meta: { source: "manual", mark: "red", pid: getCurrentPidValue() }
      });
    });

    cb.addEventListener("change", () => {
      const user = getCurrentUser();
      if(!user){
        cb.checked = !cb.checked;
        requireLogin("Du skal være logget ind for at kunne sætte krydser.");
        return;
      }
      if(!canAllocateNumbers(user)){
        cb.checked = !cb.checked;
        alert("Du skal have planner eller admin adgang for at kunne reservere/gemme numre.");
        return;
      }

      const now = new Date().toISOString();
      const previousStatus = codeSource[codeKey] ? getMarkForCode(codeKey) : null;

      if(isPlannerOnly(user)){
        if(previousStatus && previousStatus !== TAG_STATUS.RESERVED){
          cb.checked = !cb.checked;
          alert("Planner kan kun tilføje eller fjerne orange projektnumre. I brug/frigivet ændres af admin.");
          return;
        }
        if(currentMark !== TAG_STATUS.RESERVED) setMarkMode(TAG_STATUS.RESERVED);
      }

      const markToApply = isPlannerOnly(user) ? TAG_STATUS.RESERVED : currentMark;

      if(cb.checked){
        codeSource[codeKey] = "manual";
        codeMeta[codeKey] = {
          by: user.initials,
          at: now,
          source: "manual",
          mark: markToApply,
          pid: getCurrentPidValue(),
          pidIdx: currentPidIdx,
          pidColor: (pidOptions.length > 1) ? (currentPidIdx % 4) : 0,
        };
        changeBuffer.push({ at: now, by: user.initials, action: "CHECK", code: codeKey, source: "manual", mark: markToApply });
      }else if(codeSource[codeKey] && getMarkForCode(codeKey) !== markToApply){
        cb.checked = true;
        const prev = codeMeta[codeKey] || {};
        codeSource[codeKey] = prev.source === "scan" ? "scan" : "manual";
        codeMeta[codeKey] = {
          ...prev,
          by: user.initials,
          at: now,
          mark: markToApply,
          pid: prev.pid ?? getCurrentPidValue(),
          pidIdx: Number.isFinite(parseInt(prev.pidIdx,10)) ? parseInt(prev.pidIdx,10) : currentPidIdx,
          pidColor: prev.pidColor ?? ((pidOptions.length > 1) ? (currentPidIdx % 4) : 0),
        };
        changeBuffer.push({ at: now, by: user.initials, action: "STATUS_CHANGE", code: codeKey, source: codeSource[codeKey], mark: markToApply });
      }else{
        delete codeSource[codeKey];
        delete codeMeta[codeKey];
        changeBuffer.push({ at: now, by: user.initials, action: "UNCHECK", code: codeKey, source: "manual", mark: previousStatus });
      }

      updateSelectedCodes();
      saveDraft("status-change");
      scheduleAutoSave("status-change");

      const mainRaw = (fields.main.value || "").trim();
      logAudit({
        action: cb.checked ? "CHECK" : "UNCHECK",
        record_id: activeId,
        hovednr: parseMainNumber(mainRaw) || null,
        opsaetning: parseInt(codeKey, 10),
        tag: buildTag(mainRaw, codeKey) || null,
        meta: { source: "manual", mark: cb.checked ? markToApply : previousStatus, pid: cb.checked ? getCurrentPidValue() : null }
      });
    });

    const code = document.createElement("span");
    code.className = "code";
    code.textContent = displayNumberForSeries(i);

    wrap.appendChild(cb);
    wrap.appendChild(code);
    gridEl.appendChild(wrap);
  }
}


// ---------- Read / write form state ----------
function getAllCheckboxes(){
  return Array.from(document.querySelectorAll(".cb"));
}
function getSelectedCodes(){
  return Object.keys(codeSource || {})
    .sort((x,y)=>parseInt(x,10)-parseInt(y,10));
}
function setSelectedCodes(codes, source="manual", mark=null){
  const set = new Set((codes || []).map(c => String(c)));

  // Remove anything not in the new set
  for(const code of Object.keys(codeSource || {})){
    if(!set.has(code)){
      delete codeSource[code];
      delete codeMeta[code];
    }
  }

  // Add/update anything in the set
  for(const code of set){
    codeSource[code] = source;
    const prev = codeMeta[code] || {};
    const m = normalizeTagStatus(mark || prev.mark || TAG_STATUS.ACTIVE);
    codeMeta[code] = {
      ...prev,
      source,
      mark: m,
      pid: prev.pid ?? getCurrentPidValue(),
      pidIdx: Number.isFinite(parseInt(prev.pidIdx,10)) ? parseInt(prev.pidIdx,10) : currentPidIdx,
      pidColor: prev.pidColor ?? ((Number.isFinite(parseInt(prev.pidIdx,10)) ? parseInt(prev.pidIdx,10) : currentPidIdx) % 4),
    };
  }

  // Sync visible checkboxes for current series
  getAllCheckboxes().forEach(cb => {
    const code = cb.dataset.code;
    const isSel = !!codeSource[code];
    cb.checked = isSel;
  });

  updateSelectedCodes();
}
function updateSelectedCodes(){
  const allCodes = getSelectedCodes();
  const codes = (currentFilter === "all")
    ? allCodes
    : allCodes.filter(code => {
      if(currentFilter === "scan") return isScanSourceForCode(code);
      return getMarkForCode(code) === currentFilter;
    });

  if(!allCodes.length){
    selectedCodesEl.textContent = "0 valgt";
  }else if(!codes.length){
    selectedCodesEl.innerHTML = `<span class="muted">Ingen valgte i visningen</span>`;
  }else{
    const pills = codes.map(code => {
      const mark = getMarkForCode(code);
      const meta = codeMeta?.[code] || {};
      const pidColor = (pidOptions.length > 1) ? (meta.pidColor ?? ((meta.pidIdx ?? 0) % 4)) : null;
      const label = formatOpsaetning(code);
      const pidAttr = (pidOptions.length > 1) ? ` data-pid="${pidColor}"` : "";
      const pidDot = (pidOptions.length > 1) ? `<span class="pillPidDot"></span>` : "";
      const sourceDot = isScanSourceForCode(code) ? `<span class="pillSourceDot" title="Scan/import"></span>` : "";
      return `<span class="pill" data-mark="${mark}"${pidAttr}><span class="pillDot"></span>${pidDot}${sourceDot}${label}</span>`;
    }).join("");

    selectedCodesEl.innerHTML = `<span class="codePills">${pills}</span>`;
  }

  // Sync visible checkbox states + colors
  getAllCheckboxes().forEach(cb => {
    const code = cb.dataset.code;
    const isSel = !!codeSource[code];

    cb.checked = isSel;

    if(isSel){
      const src = codeSource[code] || "manual";
      const meta = codeMeta?.[code] || {};
      const mark = normalizeTagStatus(meta.mark || TAG_STATUS.ACTIVE);

      cb.dataset.mark = mark;
      if(isScanSourceForCode(code)) cb.dataset.source = "scan";
      else delete cb.dataset.source;

      // PID (kun hvis flere PID-numre)
      if(pidOptions.length > 1){
        const pidColor = meta.pidColor ?? ((meta.pidIdx ?? 0) % 4);
        cb.dataset.pid = String(pidColor);
      }else{
        delete cb.dataset.pid;
      }

      // Filter: dim selected checkboxes that don't match
      if(currentFilter === "scan" && !isScanSourceForCode(code)) cb.dataset.dim = "1";
      else if(currentFilter !== "all" && currentFilter !== "scan" && mark !== currentFilter) cb.dataset.dim = "1";
      else delete cb.dataset.dim;

      if(meta?.by){
        const when = meta.at ? new Date(meta.at).toLocaleString() : "";
        const pidTxt = (meta.pid && pidOptions.length > 1) ? ` — PID ${meta.pid}` : "";
        const sourceTxt = isScanSourceForCode(code) ? "scan/import" : "manuel";
        cb.title = `${meta.by}${when ? " — " + when : ""} (${sourceTxt}) — ${tagStatusLabel(mark)}${pidTxt}`;
      }else{
        cb.removeAttribute("title");
      }
    }else{
      delete cb.dataset.mark;
      delete cb.dataset.dim;
      delete cb.dataset.pid;
      delete cb.dataset.source;
      cb.removeAttribute("title");
    }
  });

  updateAvailabilityDisplay();
}

function getBlockingCodesInOtherRecords(mainRaw, excludeId){
  const main = stripLeadingZeros(parseMainNumber(mainRaw));
  if(!main) return new Map();
  const used = new Map();
  for(const r of loadRecords() || []){
    if(!r || !r.hovedkomponentnr) continue;
    if(excludeId && r.id === excludeId) continue;
    const m = stripLeadingZeros(String(r.hovedkomponentnr));
    if(m !== main) continue;
    (r.selectedCodes || []).forEach(c => {
      const code = String(c);
      const status = getRecMark(r, code);
      if(isBlockingStatus(status) && !used.has(code)){
        used.set(code, status);
      }
    });
  }
  return used;
}

function updateAvailabilityDisplay(){
  if(!availableCodesEl) return;

  const mainRaw = fields.main?.value || "";
  const main = parseMainNumber(mainRaw);
  if(!main){
    if(availCountEl) availCountEl.textContent = "—";
    availableCodesEl.innerHTML = `<span class="muted">Udfyld hovednr. for at se ledige numre.</span>`;
    if(matrixCandidatesEl) matrixCandidatesEl.innerHTML = `<span class="muted">Udfyld hovednr. for at se matrix-rækker.</span>`;
    if(suffixSeriesEl) suffixSeriesEl.textContent = "—";
    return;
  }

  const usedOther = getBlockingCodesInOtherRecords(mainRaw, activeId);

  let freeCount = 0;
  let takenCount = 0;
  const freeNums = [];

  for(let i=1;i<=99;i++){
    const codeKey = codeKeyForSeries(i);
    const isSel = !!codeSource[codeKey] && isBlockingStatus(getMarkForCode(codeKey));
    const isTaken = !isSel && usedOther.has(codeKey);
    if(isTaken) takenCount++;
    if(!isSel && !isTaken){
      freeCount++;
      freeNums.push(i);
    }
  }

  if(availCountEl) availCountEl.textContent = `${freeCount} ledige · ${takenCount} optaget`;

  // Vis kun de ledige numre – kompakt som intervaller
  const ranges = compressRanges(freeNums);
  if(!ranges.length){
    availableCodesEl.innerHTML = `<span class="muted">Ingen ledige numre i denne serie.</span>`;
  }else{
    const pills = ranges.map(([s,e]) => {
      const a = formatOpsaetning(codeKeyForSeries(s));
      const b = formatOpsaetning(codeKeyForSeries(e));
      const txt = (s === e) ? a : `${a}–${b}`;
      return `<span class="availPill" data-state="free"><span class="availPillDot"></span>${txt}</span>`;
    });
    availableCodesEl.innerHTML = pills.join("");
  }

  renderMatrixCandidates(mainRaw, usedOther);
  renderSuffixOverview(mainRaw, usedOther);
}

function renderSuffixOverview(mainRaw, usedOther){
  if(!suffixSeriesEl) return;

  const main = parseMainNumber(mainRaw);
  if(!main){
    suffixSeriesEl.textContent = "—";
    return;
  }

  const typed = parseSuffixInput(suffixInputEl?.value);
  const suffix = typed ?? currentSuffix ?? 1;
  currentSuffix = suffix;

  // Hvis feltet er tomt, så udfyld med den aktive suffix (to cifre)
  if(suffixInputEl && !String(suffixInputEl.value || "").trim()){
    suffixInputEl.value = pad2(suffix);
  }

  // Hvis brugeren skriver noget ugyldigt, vis tydelig feedback
  if(suffixInputEl && String(suffixInputEl.value || "").trim() && typed === null){
    suffixSeriesEl.innerHTML = `<span class="muted">Skriv 01–99</span>`;
    return;
  }

  const pills = [];
  for(let s=0;s<=9;s++){
    const codeKey = codeKeyForExplicitSeries(s, suffix);
    const isSel = !!codeSource[codeKey];
    const otherStatus = usedOther.get(codeKey);
    const isTaken = !isSel && !!otherStatus;
    const state = isSel ? "selected" : (isTaken ? (otherStatus === TAG_STATUS.RESERVED ? "reserved" : "taken") : "free");
    let markAttr = "";
    if(isSel){
      const mark = getMarkForCode(codeKey);
      markAttr = ` data-mark="${mark}"`;
    }else if(isTaken){
      markAttr = ` data-mark="${otherStatus}"`;
    }
    pills.push(`<span class="sxPill" data-series="${s}" data-state="${state}"${markAttr}><span class="sxPillDot"></span>${s}xx</span>`);
  }
  suffixSeriesEl.innerHTML = pills.join("");
}

function renderMatrixCandidates(mainRaw, usedOther){
  if(!matrixCandidatesEl) return;

  const main = parseMainNumber(mainRaw);
  if(!main){
    matrixCandidatesEl.innerHTML = `<span class="muted">Udfyld hovednr. for at se matrix-rækker.</span>`;
    return;
  }

  const candidates = [];
  for(let suffix=1; suffix<=99; suffix++){
    let free = 0;
    let reserved = 0;
    let occupied = 0;
    let selected = 0;

    for(let s=0; s<=9; s++){
      const codeKey = codeKeyForExplicitSeries(s, suffix);
      if(codeSource[codeKey] && isBlockingStatus(getMarkForCode(codeKey))){
        selected++;
        if(getMarkForCode(codeKey) === TAG_STATUS.RESERVED) reserved++;
        else if(isBlockingStatus(getMarkForCode(codeKey))) occupied++;
        continue;
      }

      const otherStatus = usedOther.get(codeKey);
      if(!otherStatus) free++;
      else if(otherStatus === TAG_STATUS.RESERVED) reserved++;
      else occupied++;
    }

    candidates.push({ suffix, free, reserved, occupied, selected });
  }

  const best = candidates
    .filter(c => c.free > 0)
    .sort((a,b) => (b.free - a.free) || (a.occupied - b.occupied) || (a.reserved - b.reserved) || (a.suffix - b.suffix))
    .slice(0, 8);

  if(!best.length){
    matrixCandidatesEl.innerHTML = `<span class="muted">Ingen ledige matrix-rækker fundet.</span>`;
    return;
  }

  matrixCandidatesEl.innerHTML = best.map(c => {
    const state = c.occupied === 0 && c.reserved === 0 && c.selected === 0 ? "free" : "mixed";
    const title = `${pad2(c.suffix)}: ${c.free}/10 ledige, ${c.reserved} projekt, ${c.occupied} optaget`;
    return `<button class="matrixPill" type="button" data-suffix="${pad2(c.suffix)}" data-state="${state}" title="${title}">${pad2(c.suffix)} <span>${c.free}/10</span></button>`;
  }).join("");

  matrixCandidatesEl.querySelectorAll(".matrixPill").forEach(btn => {
    btn.addEventListener("click", () => {
      const suffix = btn.dataset.suffix;
      if(suffixInputEl) suffixInputEl.value = suffix;
      currentSuffix = parseInt(suffix, 10);
      renderSuffixOverview(mainRaw, usedOther);
    });
  });
}

function applyCheckChange(codeKey, checked, markOverride=null){
  const user = getCurrentUser();
  if(!user){
    requireLogin("Du skal være logget ind for at kunne sætte krydser.");
    return;
  }
  if(!canAllocateNumbers(user)){
    alert("Du skal have planner eller admin adgang for at kunne reservere/gemme numre.");
    return;
  }
  if(isPlannerOnly(user)){
    const previousStatus = codeSource[codeKey] ? getMarkForCode(codeKey) : null;
    const requestedStatus = normalizeTagStatus(markOverride || currentMark);
    if((previousStatus && previousStatus !== TAG_STATUS.RESERVED) || requestedStatus !== TAG_STATUS.RESERVED){
      alert("Planner kan kun tilføje eller fjerne orange projektnumre.");
      return;
    }
  }

  const now = new Date().toISOString();
  const mark = isPlannerOnly(user) ? TAG_STATUS.RESERVED : (markOverride || currentMark);
  if(checked){
    codeSource[codeKey] = "manual";
    codeMeta[codeKey] = {
      by: user.initials,
      at: now,
      source: "manual",
      mark,
      pid: getCurrentPidValue(),
      pidIdx: currentPidIdx,
      pidColor: (pidOptions.length > 1) ? (currentPidIdx % 4) : 0,
    };
    changeBuffer.push({ at: now, by: user.initials, action: "CHECK", code: codeKey, source: "manual", mark });
  }else{
    delete codeSource[codeKey];
    delete codeMeta[codeKey];
    changeBuffer.push({ at: now, by: user.initials, action: "UNCHECK", code: codeKey, source: "manual" });
  }

  // Sync visible checkbox (hvis den er på den aktuelle serie/side)
  const cb = document.querySelector(`.cb[data-code="${codeKey}"]`);
  if(cb) cb.checked = checked;

  updateSelectedCodes();
  saveDraft("status-change");
  scheduleAutoSave("status-change");

  const mainRaw = (fields.main.value || "").trim();
  logAudit({
    action: checked ? "CHECK" : "UNCHECK",
    record_id: activeId,
    hovednr: parseMainNumber(mainRaw) || null,
    opsaetning: parseInt(codeKey, 10),
    tag: buildTag(mainRaw, codeKey) || null,
    meta: { source: "manual", mark: checked ? mark : null, pid: checked ? getCurrentPidValue() : null }
  });
}


function clearForm(){
  activeId = null;
  loadedRecordUpdatedAt = null;
  changeBuffer = [];
  codeMeta = {};
  codeSource = {};
  fields.main.value = "";
  fields.desc.value = "";
  fields.plant.value = "";
  fields.pid.value = "";
  refreshPidOptionsFromField();
  fields.sign1.value = "";
  setDateFieldValue(fields.sign2, "", true);
  setSelectedCodes([]);
  renderRevisions(null);
  renderRecordList();
  setEditingEnabled();
  clearDraft();
}

function getFormData(){
  const user = getCurrentUser();
  const existing = activeId ? loadRecords().find(r => r.id === activeId) : null;
  const nowIso = new Date().toISOString();

  const rec = {
    id: activeId ?? crypto.randomUUID(),
    hovedkomponentnr: parseMainNumber(fields.main.value),
    beskrivelse: fields.desc.value.trim(),
    anlaeg: fields.plant.value.trim(),
    pid: fields.pid.value.trim(),
    signatur1: fields.sign1.value.trim(),
    signatur2: getDateFieldValue(fields.sign2).trim(),
    selectedCodes: getSelectedCodes(),
    codeSources: {...codeSource},          // per code: scan/manual
    codeMeta: {},                          // filled below
    editedBy: user?.initials ?? "—",
    updatedAt: nowIso,
    _baseUpdatedAt: loadedRecordUpdatedAt || existing?.updatedAt || null,
    audit: Array.isArray(existing?.audit) ? [...existing.audit] : [],
    revisions: Array.isArray(existing?.revisions) ? [...existing.revisions] : [],
  };

  // Keep only metadata for selected codes; add defaults if missing
  const selSet = new Set(rec.selectedCodes);
  const metaOut = {};
  for(const code of rec.selectedCodes){
    if(codeMeta[code]){
      const src = (codeSource[code] || codeMeta[code].source || "manual");
      metaOut[code] = { ...codeMeta[code], source: src, mark: normalizeTagStatus(codeMeta[code].mark || TAG_STATUS.ACTIVE) };
    }else{
      metaOut[code] = {
        by: user?.initials ?? "—",
        at: nowIso,
        source: (codeSource[code] || "manual"),
        mark: TAG_STATUS.ACTIVE,
        pid: getCurrentPidValue(),
        pidIdx: currentPidIdx,
        pidColor: (pidOptions.length > 1) ? (currentPidIdx % 4) : 0,
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
      status: e.mark ? normalizeTagStatus(e.mark) : null,
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
  loadedRecordUpdatedAt = rec.updatedAt || null;
  changeBuffer = [];

  fields.main.value = rec.hovedkomponentnr ?? "";
  fields.desc.value = rec.beskrivelse ?? "";
  fields.plant.value = rec.anlaeg ?? "";
  fields.pid.value = rec.pid ?? "";
  refreshPidOptionsFromField();
  fields.sign1.value = rec.signatur1 ?? "";
  setDateFieldValue(fields.sign2, rec.signatur2 ?? "");

  const selected = Array.isArray(rec.selectedCodes) ? rec.selectedCodes.map(String) : [];

  // Restore sources (fallback to manual)
  const sourcesIn = rec.codeSources && typeof rec.codeSources === "object" ? rec.codeSources : {};
  codeSource = {};
  if(Object.keys(sourcesIn).length){
    for(const [k,v] of Object.entries(sourcesIn)){
      codeSource[String(k)] = (v === "scan") ? "scan" : "manual";
    }
  }else{
    for(const code of selected){
      codeSource[code] = "manual";
    }
  }

  // Restore meta + add defaults
  const metaIn = rec.codeMeta && typeof rec.codeMeta === "object" ? rec.codeMeta : {};
  codeMeta = {};
  const nowIso = new Date().toISOString();

  for(const code of Object.keys(codeSource)){
    const src = codeSource[code] || "manual";
    const prev = metaIn[code] || {};
    const mark = normalizeTagStatus(prev.mark || TAG_STATUS.ACTIVE);

    const pidIdx = Number.isFinite(parseInt(prev.pidIdx,10)) ? parseInt(prev.pidIdx,10) : 0;
    const pidVal = prev.pid || (pidOptions.length ? pidOptions[0] : null) || null;

    codeMeta[code] = {
      by: prev.by || rec.editedBy || "—",
      at: prev.at || rec.updatedAt || nowIso,
      source: prev.source || src,
      mark,
      pid: pidVal,
      pidIdx,
      pidColor: prev.pidColor ?? (pidIdx % 4),
    };
  }

  rebuildGrids();
  renderRevisions(rec);
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

function stripClientOnlyRecordFields(rec){
  const out = { ...(rec || {}) };
  delete out._baseUpdatedAt;
  delete out.baseUpdatedAt;
  return out;
}

// Fetch records into cache (cloud) without changing the current UI state.
async function fetchRecordsCache(){
  if(!USE_CLOUD) return;
  const user = getCurrentUser();
  if(!user) { recordsCache = []; return; }
  const data = await apiFetch("/records", { method: "GET" });
  recordsCache = Array.isArray(data?.records) ? data.records : [];
}

async function refreshRecords(){
  updateSyncBadge(USE_CLOUD ? "Opdaterer..." : "Lokal demo");
  if(!USE_CLOUD){
    recordsCache = [];
    renderRecordList();
    updateSyncBadge();
    return;
  }
  const user = getCurrentUser();
  if(!user){
    recordsCache = [];
    renderRecordList();
    updateSyncBadge();
    return;
  }
  await fetchRecordsCache();
  renderRecordList();
  updateAvailabilityDisplay();
  updateSyncBadge("Cloud synkroniseret");
}

async function upsertRecord(rec){
  updateSyncBadge(USE_CLOUD ? "Gemmer..." : "Gemmer lokalt...");
  const existing = rec?.id ? loadRecords().find(r => r.id === rec.id) : null;
  const requestRec = { ...(rec || {}) };
  if(!requestRec._baseUpdatedAt && !requestRec.baseUpdatedAt && existing?.updatedAt){
    requestRec._baseUpdatedAt = existing.updatedAt;
  }

  if(!USE_CLOUD){
    const localRec = stripClientOnlyRecordFields(requestRec);
    const records = loadRecordsLocal();
    const idx = records.findIndex(r => r.id === localRec.id);
    if(idx >= 0) records[idx] = localRec;
    else records.unshift(localRec);
    saveRecordsLocal(records);
    updateSyncBadge("Gemt lokalt");
    return records;
  }

  const data = await apiFetch("/records/upsert", {
    method: "POST",
    body: JSON.stringify(requestRec),
  });

  const saved = stripClientOnlyRecordFields(data?.record || rec);
  const idx = recordsCache.findIndex(r => r.id === saved.id);
  if(idx >= 0) recordsCache[idx] = saved;
  else recordsCache.unshift(saved);

  updateSyncBadge("Cloud synkroniseret");
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

function readDraft(){
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch{
    return null;
  }
}

function draftHasContent(draft){
  const fieldsIn = draft?.fields || {};
  const hasFields = Object.values(fieldsIn).some(v => String(v || "").trim());
  const hasCodes = Object.keys(draft?.codeSource || {}).length > 0;
  return !!(draft?.activeId || hasFields || hasCodes);
}

function saveDraft(reason = "edit"){
  const user = getCurrentUser();
  if(!user) return;

  const draft = {
    version: 1,
    reason,
    savedAt: new Date().toISOString(),
    userInitials: user.initials,
    role: normalizeRole(user.role),
    activeId,
    loadedRecordUpdatedAt,
    currentSeries,
    currentFilter,
    currentMark,
    currentSuffix,
    currentPidIdx,
    fields: {
      main: fields.main?.value || "",
      desc: fields.desc?.value || "",
      plant: fields.plant?.value || "",
      pid: fields.pid?.value || "",
      sign1: fields.sign1?.value || "",
      sign2: getDateFieldValue(fields.sign2),
    },
    codeSource: { ...codeSource },
    codeMeta: { ...codeMeta },
    changeBuffer: Array.isArray(changeBuffer) ? [...changeBuffer] : [],
  };

  if(!draftHasContent(draft)){
    localStorage.removeItem(DRAFT_KEY);
    updateSyncBadge();
    return;
  }

  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  updateSyncBadge("Kladde gemt lokalt");
}

function clearDraft(){
  localStorage.removeItem(DRAFT_KEY);
  updateSyncBadge();
}

function restoreDraft(draft){
  if(!draft || !draftHasContent(draft)) return false;

  activeId = draft.activeId || null;
  loadedRecordUpdatedAt = draft.loadedRecordUpdatedAt || null;
  changeBuffer = Array.isArray(draft.changeBuffer) ? [...draft.changeBuffer] : [];
  codeSource = (draft.codeSource && typeof draft.codeSource === "object") ? { ...draft.codeSource } : {};
  codeMeta = (draft.codeMeta && typeof draft.codeMeta === "object") ? { ...draft.codeMeta } : {};

  const f = draft.fields || {};
  fields.main.value = f.main || "";
  fields.desc.value = f.desc || "";
  fields.plant.value = f.plant || "";
  fields.pid.value = f.pid || "";
  fields.sign1.value = f.sign1 || "";
  setDateFieldValue(fields.sign2, f.sign2 || "");

  currentPidIdx = Number.isFinite(parseInt(draft.currentPidIdx, 10)) ? parseInt(draft.currentPidIdx, 10) : 0;
  refreshPidOptionsFromField();
  setMarkMode(draft.currentMark || TAG_STATUS.ACTIVE);
  setFilterMode(draft.currentFilter || "all");
  setSeries(Number.isFinite(parseInt(draft.currentSeries, 10)) ? parseInt(draft.currentSeries, 10) : 0);
  if(suffixInputEl && draft.currentSuffix) suffixInputEl.value = pad2(draft.currentSuffix);
  updateSelectedCodes();

  const rec = activeId ? loadRecords().find(r => r.id === activeId) : null;
  if(!loadedRecordUpdatedAt && rec?.updatedAt) loadedRecordUpdatedAt = rec.updatedAt;
  renderRevisions(rec || null);
  renderRecordList();
  updateSyncBadge("Kladde gendannet");
  return true;
}

function maybeOfferDraftRestore(){
  const user = getCurrentUser();
  if(!user) return;
  const draft = readDraft();
  if(!draftHasContent(draft)) return;
  if(draft.userInitials && draft.userInitials !== user.initials) return;

  const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString("da-DK") : "";
  const msg = `Der findes en ikke-gemt lokal kladde${when ? " fra " + when : ""}.\n\nVil du gendanne den?`;
  if(confirm(msg)){
    restoreDraft(draft);
  }else{
    clearDraft();
  }
}

function hasUnsavedLocalState(){
  if(autoSaveInFlight || autoSaveQueued || (Array.isArray(changeBuffer) && changeBuffer.length)) return true;

  const draft = readDraft();
  if(!draftHasContent(draft)) return false;

  const user = getCurrentUser();
  if(draft.userInitials && user?.initials && draft.userInitials !== user.initials) return false;
  return true;
}

window.addEventListener("beforeunload", (event) => {
  if(!hasUnsavedLocalState()) return;
  event.preventDefault();
  event.returnValue = "";
});


// ---------- List rendering ----------
function matchesSearch(rec, q){
  if(!q) return true;

  // Support searching by tags like "27.530" (main.code)
  const tags = (rec.selectedCodes||[]).map(code => buildTag(rec.hovedkomponentnr, code));
  const tagsKeepZeros = (rec.selectedCodes||[]).map(code => buildTagKeepZeros(rec.hovedkomponentnr, code));

  // If user searches for a tag with leading zeros in main, also try a normalized variant
  const qVariants = new Set([q]);
  if(q.includes(".")){
    const parts = q.split(".");
    const qMain = stripLeadingZeros(parts[0]);
    const qRest = parts.slice(1).join(".");
    if(qMain) qVariants.add(`${qMain}.${qRest}`);
  }

  const hay = [
    rec.hovedkomponentnr, rec.beskrivelse, rec.anlaeg, rec.pid,
    (rec.selectedCodes||[]).join(";"),
    tags.join(" "),
    tagsKeepZeros.join(" ")
  ].join(" ").toLowerCase();

  for(const v of qVariants){
    if(hay.includes(v)) return true;
  }
  return false;
}

function renderRecordList(){
  const q = (searchEl.value || "").trim().toLowerCase();
  const allRecords = loadRecords();
  const records = allRecords.filter(r => matchesSearch(r,q));

  if(searchResultCountEl){
    const suffix = q ? "match" : "poster";
    searchResultCountEl.textContent = `${records.length} ${suffix}`;
  }

  recordListEl.innerHTML = "";
  if(records.length === 0){
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = q ? "Ingen poster matcher søgningen." : "Ingen gemte poster endnu.";
    recordListEl.appendChild(empty);
    updateSelectedRecordCount();
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

    const left = document.createElement("div");
    left.className = "record__left";

    const sel = document.createElement("input");
    sel.type = "checkbox";
    sel.className = "record__select";
    sel.checked = selectedRecordIds.has(rec.id);
    sel.title = "Markér posten til samlet Excel-eksport";
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", (e) => {
      e.stopPropagation();
      if(sel.checked) selectedRecordIds.add(rec.id);
      else selectedRecordIds.delete(rec.id);
      updateSelectedRecordCount();
    });

    const title = document.createElement("div");
    title.className = "record__title";
    title.textContent = rec.hovedkomponentnr || "(uden nr.)";

    const badge = document.createElement("div");
    badge.className = "badge";
    const nSel = (rec.selectedCodes?.length ?? 0);
    const mk = summarizeMarks(rec);
    badge.textContent = `${nSel} numre (🔵${mk.blue} 🟠${mk.reserved} 🔴${mk.red} · ${mk.scan} scan)`;

    left.appendChild(sel);
    left.appendChild(title);
    top.appendChild(left);
    top.appendChild(badge);

    const meta = document.createElement("div");
    meta.className = "record__meta";
    meta.innerHTML =
      `<div><strong>Anlæg:</strong> ${escapeHtml(rec.anlaeg || "—")} <strong>PID:</strong> ${escapeHtml(rec.pid || "—")}</div>` +
      `<div>${escapeHtml(rec.beskrivelse || "")}</div>` +
      `<div class="muted">${new Date(rec.updatedAt).toLocaleString()}</div>` +
      `<div class="muted">Sidste ændring: ${escapeHtml(lastRevisionString(rec) || "—")}</div>`;

    const actions = document.createElement("div");
    actions.className = "record__actions";

    if(canManageUsers()){
      const btnDel = document.createElement("button");
      btnDel.className = "btn";
      btnDel.textContent = "Slet";
      btnDel.addEventListener("click", (e) => {
        e.stopPropagation();
        if(confirm("Slet posten?")){
          (async () => {
            try{
              await deleteRecord(rec.id);
              selectedRecordIds.delete(rec.id);
              updateSelectedRecordCount();
              if(activeId === rec.id) clearForm();
              renderRecordList();
              await logAudit({ action: "DELETE", record_id: rec.id, hovednr: rec.hovedkomponentnr || null });
            }catch(err){
              alert("Kunne ikke slette: " + (err?.message ?? err));
            }
          })();
        }
      });
      actions.appendChild(btnDel);
    }

    card.appendChild(top);
    card.appendChild(meta);
    if(actions.childElementCount) card.appendChild(actions);

    recordListEl.appendChild(card);
  });

  updateSelectedRecordCount();
}

function updateSelectedRecordCount(){
  if(!selectedRecordCountEl) return;
  const n = selectedRecordIds.size;
  selectedRecordCountEl.textContent = `${n} valgt`;
}

function getVisibleRecords(){
  const q = (searchEl.value || "").trim().toLowerCase();
  return loadRecords().filter(r => matchesSearch(r,q));
}

if(btnSelectAllVisible){
  btnSelectAllVisible.addEventListener("click", () => {
    getVisibleRecords().forEach(r => selectedRecordIds.add(r.id));
    renderRecordList();
  });
}

if(btnSelectNone){
  btnSelectNone.addEventListener("click", () => {
    selectedRecordIds = new Set();
    renderRecordList();
  });
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}


// Import JSON (backup)
const importFile = document.getElementById("importFile");
const importDataModal = document.getElementById("importDataModal");
const btnImportDataClose = document.getElementById("btnImportDataClose");
const btnImportTagList = document.getElementById("btnImportTagList");
const btnImportJsonBackup = document.getElementById("btnImportJsonBackup");
const excelTagsFile = document.getElementById("excelTagsFile");
const btnImportExcelTags = document.getElementById("btnImportExcelTags");

function openImportDataModal(){
  if(!requireAdmin("Kun admin kan importere Access/Excel/JSON data.")) return;
  importDataModal?.setAttribute("aria-hidden", "false");
}

function closeImportDataModal(){
  importDataModal?.setAttribute("aria-hidden", "true");
}

function extractRecordsFromBackupPayload(payload){
  if(Array.isArray(payload)) return payload;
  if(Array.isArray(payload?.records)) return payload.records;
  if(Array.isArray(payload?.database?.records)) return payload.database.records;
  throw new Error("JSON backup skal indeholde en liste af poster eller et records-felt.");
}

document.getElementById("btnImport")?.addEventListener("click", openImportDataModal);
btnImportDataClose?.addEventListener("click", closeImportDataModal);
importDataModal?.querySelector(".modal__backdrop")?.addEventListener("click", closeImportDataModal);

btnImportTagList?.addEventListener("click", () => {
  if(!requireAdmin("Kun admin kan importere Access/Excel/CSV data.")) return;
  closeImportDataModal();
  excelTagsFile?.click();
});

btnImportJsonBackup?.addEventListener("click", () => {
  if(!requireAdmin("Kun admin kan importere JSON backup.")) return;
  closeImportDataModal();
  importFile?.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if(!file) return;
  const importUser = requireAdmin("Kun admin kan importere JSON backup.");
  if(!importUser){
    importFile.value = "";
    return;
  }
  try{
    const text = await file.text();
    const records = extractRecordsFromBackupPayload(JSON.parse(text));
    if(!Array.isArray(records)) throw new Error("JSON skal være en liste (array) af poster.");

    if(USE_CLOUD){
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

// Import Excel (.xls/.xlsx) med kolonnen 'NR' (tags)
function ensureRecordShape(rec){
  if(!rec || typeof rec !== "object") return;
  if(!Array.isArray(rec.selectedCodes)) rec.selectedCodes = [];
  if(!rec.codeSources || typeof rec.codeSources !== "object") rec.codeSources = {};
  if(!rec.codeMeta || typeof rec.codeMeta !== "object") rec.codeMeta = {};
  if(!Array.isArray(rec.audit)) rec.audit = [];
  if(!Array.isArray(rec.revisions)) rec.revisions = [];
}

function findRecordByMainKey(mainKey){
  const key = normalizeMainKey(mainKey);
  if(!key) return { rec: null, duplicates: 0 };
  const matches = loadRecords().filter(r => normalizeMainKey(r?.hovedkomponentnr) === key);
  return { rec: matches[0] || null, duplicates: Math.max(0, matches.length - 1) };
}

async function importTagsFromExcel(file){
  if(!file) return;

  const user = requireAdmin("Kun admin kan importere Excel (det opretter/ajourfører poster og logger initialer).");
  if(!user) return;

  if(typeof XLSX === "undefined"){
    alert("Excel-import kræver XLSX-biblioteket (SheetJS)." );
    return;
  }

  try{
    if(USE_CLOUD){
      // Hold cache opdateret før merge
      await refreshRecords();
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames?.[0];
    if(!sheetName) throw new Error("Excel-filen indeholder ingen ark.");

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    if(!Array.isArray(rows) || rows.length === 0) throw new Error("Excel-arket er tomt.");

    // Find 'NR' kolonne (fallback: første kolonne)
    const header = (rows[0] || []).map(x => String(x || "").trim().toLowerCase());
    let colIdx = header.findIndex(h => h === "nr");
    if(colIdx < 0) colIdx = 0;

    // Group tags per hovednummer
    const groups = new Map(); // key(normalized main) -> {mainRaw, codes:Set}
    let invalidCount = 0;

    for(let r=1; r<rows.length; r++){
      const cell = rows[r]?.[colIdx];
      if(cell === null || cell === undefined) continue;
      const rawCell = String(cell).trim();
      if(!rawCell) continue;

      const parts = rawCell.split(/[\n,;\t ]+/g).map(s => s.trim()).filter(Boolean);
      for(const part of parts){
        const parsed = parseTagString(part);
        if(!parsed){ invalidCount++; continue; }

        const key = normalizeMainKey(parsed.mainRaw);
        if(!key){ invalidCount++; continue; }

        if(!groups.has(key)) groups.set(key, { mainRaw: parsed.mainRaw, codes: new Set() });
        groups.get(key).codes.add(String(parsed.codeKey));
      }
    }

    if(groups.size === 0){
      alert("Fandt ingen gyldige tags i importfilen.\n\nForventet format: 4390.002 (kolonne 'NR').");
      return;
    }

    const totalTags = [...groups.values()].reduce((sum,g) => sum + g.codes.size, 0);
    const ok = confirm(
      `Fandt ${totalTags} tags fordelt på ${groups.size} hovednumre.\n` +
      `Importerede tags registreres som 'I brug' med kilde 'Access/Excel'.\n\n` +
      `Vil du oprette/ajourføre posterne nu?`
    );
    if(!ok) return;

    const desc = await requestRevisionDescriptionPrefill("Access/Excel import");
    if(desc === null) return;
    const revDesc = String(desc || "").trim() || "Access/Excel import";

    const nowIso = new Date().toISOString();
    let created = 0, updated = 0, dupWarnings = 0, addedTotal = 0;
    let firstSaved = null;

    for(const [key, g] of groups.entries()){
      const { rec: existing, duplicates } = findRecordByMainKey(g.mainRaw);
      if(duplicates) dupWarnings += duplicates;

      const prevRec = existing ? JSON.parse(JSON.stringify(existing)) : null;
      const rec = existing ? JSON.parse(JSON.stringify(existing)) : {
        id: crypto.randomUUID(),
        hovedkomponentnr: g.mainRaw,
        beskrivelse: "",
        anlaeg: "",
        pid: "",
        signatur1: "",
        signatur2: "",
        selectedCodes: [],
        codeSources: {},
        codeMeta: {},
        editedBy: user.initials,
        updatedAt: nowIso,
        audit: [],
        revisions: [],
      };

      ensureRecordShape(rec);

      // Behold eksisterende hovednr formatting hvis posten findes
      if(existing && existing.hovedkomponentnr) rec.hovedkomponentnr = existing.hovedkomponentnr;
      else rec.hovedkomponentnr = g.mainRaw;

      const sel = new Set((rec.selectedCodes || []).map(String));
      const added = [];

      for(const code of g.codes){
        const c = String(code);
        if(!sel.has(c)){
          sel.add(c);
          added.push(c);

          // Access/Excel import is a source, not a separate occupied-number status.
          rec.codeSources[c] = "scan";
          rec.codeMeta[c] = {
            by: user.initials,
            at: nowIso,
            source: "scan",
            mark: TAG_STATUS.ACTIVE,
            pid: null,
            pidIdx: 0,
            pidColor: 0,
          };
        }else{
          // Hvis allerede valgt, så sørg for at meta findes (men overskriv ikke eksisterende mark)
          rec.codeSources[c] = rec.codeSources?.[c] || "manual";
          if(!rec.codeMeta?.[c]){
            rec.codeMeta[c] = {
              by: user.initials,
              at: nowIso,
              source: rec.codeSources[c],
              mark: TAG_STATUS.ACTIVE,
              pid: null,
              pidIdx: 0,
              pidColor: 0,
            };
          }
        }
      }

      // Sortér numerisk
      rec.selectedCodes = [...sel].sort((a,b) => (parseInt(a,10) - parseInt(b,10)));
      rec.editedBy = user.initials;
      rec.updatedAt = nowIso;

      // Audit + revisions
      const removed = [];
      rec.audit.push({
        at: nowIso,
        by: user.initials,
        action: existing ? "IMPORT_EDIT" : "IMPORT_CREATE",
        added,
        removed,
        sourceSummary: summarizeSources(rec),
      });

      const changes = computeTagChanges(prevRec, rec);
      rec.revisions.push({ at: nowIso, by: user.initials, desc: revDesc, changes });

      await upsertRecord(rec);

      if(!firstSaved) firstSaved = rec;
      if(existing) updated += 1;
      else created += 1;
      addedTotal += added.length;

      if(USE_CLOUD){
        await logAudit({
          action: existing ? "IMPORT_EDIT" : "IMPORT_CREATE",
          record_id: rec.id,
          hovednr: rec.hovedkomponentnr || null,
          meta: { revDesc, addedCount: added.length, totalSelected: rec.selectedCodes.length }
        });
      }
    }

    // Refresh UI
    if(USE_CLOUD) await refreshRecords();
    else renderRecordList();
    updateAvailabilityDisplay();

    if(firstSaved){
      setFormData(firstSaved);
      renderRecordList();
    }

    const msg =
      `Access/Excel import færdig.\n` +
      `Oprettet: ${created}\n` +
      `Opdateret: ${updated}\n` +
      `Tilføjede tags: ${addedTotal}\n` +
      (invalidCount ? `\nUgyldige rækker/tags (ignoreret): ${invalidCount}` : "") +
      (dupWarnings ? `\n\nOBS: Der findes allerede dubletter på ${dupWarnings} post(er) i cloud for samme hovednr. (import brugte den første).` : "");

    alert(msg);

  }catch(err){
    alert("Kunne ikke importere datafilen: " + (err?.message ?? err));
  }
}

if(btnImportExcelTags && excelTagsFile){
  btnImportExcelTags.addEventListener("click", () => excelTagsFile.click());
}

if(excelTagsFile){
  excelTagsFile.addEventListener("change", async () => {
    const file = excelTagsFile.files?.[0];
    if(!file) return;
    try{
      await importTagsFromExcel(file);
    }finally{
      excelTagsFile.value = "";
    }
  });
}



// ---------- OCR (checkbox detection from scan) ----------
// NOTE: This is NOT text OCR. It's checkbox mark detection by sampling pixel darkness.
// It works best when the scan is a straight, full-page scan (A4 portrait) with little rotation.

const scanFile = document.getElementById("scanFile");
document.getElementById("btnOCR").addEventListener("click", () => scanFile.click());

scanFile.addEventListener("change", async () => {
  const file = scanFile.files?.[0];
  if(!file) return;

  const user = requireAdmin("Kun admin kan køre OCR/scan (det ændrer krydser og logger initialer).");
  if(!user){
    scanFile.value = "";
    return;
  }

  try{
    // Scan/OCR matcher kun blanketten (01-99)
    setSeries(0);

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

    // OCR gælder kun 0xx (01-99). Bevar evt. 1xx/2xx/... valg.
    const now = new Date().toISOString();

    clearSeriesCodes(0);
    for(const code of detected){
      codeSource[code] = "scan";
      codeMeta[code] = {
        by: user.initials,
        at: now,
        source: "scan",
        mark: TAG_STATUS.ACTIVE,
        pid: getCurrentPidValue(),
        pidIdx: currentPidIdx,
        pidColor: (pidOptions.length > 1) ? (currentPidIdx % 4) : 0,
      };
    }

    updateSelectedCodes();
    saveDraft("scan-import");

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
const loginForm = document.getElementById("loginForm");
const btnLogin = document.getElementById("btnLogin");
const btnLoginClose = document.getElementById("btnLoginClose");
const btnLoginSave = document.getElementById("btnLoginSave");
const btnLogout = document.getElementById("btnLogout");
const loginInitials = document.getElementById("loginInitials");
const loginPin = document.getElementById("loginPin");
const gateLoginForm = document.getElementById("gateLoginForm");
const gateLoginInitials = document.getElementById("gateLoginInitials");
const gateLoginPin = document.getElementById("gateLoginPin");
const gateLoginError = document.getElementById("gateLoginError");
const btnGateLogin = document.getElementById("btnGateLogin");
const btnGateTogglePassword = document.getElementById("btnGateTogglePassword");

function setGateError(message = ""){
  if(gateLoginError) gateLoginError.textContent = message;
  [gateLoginInitials, gateLoginPin].forEach(input => {
    input?.setAttribute("aria-invalid", message ? "true" : "false");
  });
}

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
    clearDraft();
    clearAuth();
    // For cloud-mode: tøm cache så listen er neutral indtil næste login
    if(USE_CLOUD){ recordsCache = []; renderRecordList(); }
    return;
  }
  openLogin();
});

btnLoginClose.addEventListener("click", closeLogin);
loginModal.querySelector(".modal__backdrop").addEventListener("click", closeLogin);

async function performLogin(loginValue, pin, options = {}){
  const source = options.source || "modal";
  const showInlineError = source === "gate";
  const login = normalizeLoginInput(loginValue);

  if(!login){
    const msg = "Skriv email eller initialer.";
    if(showInlineError) setGateError(msg);
    else alert(msg);
    return false;
  }
  setGateError("");

  if(USE_CLOUD){
    if(!pin || pin.length < 4 || pin.length > 64){
      const msg = "Adgangskoden skal være 4-64 tegn.";
      if(showInlineError) setGateError(msg);
      else alert(msg);
      return false;
    }
    try{
      const data = await cloudLogin(login, pin);
      setAuth({ token: data.token, user: { initials: data.initials, role: data.role, email: data.email || "" } });
      closeLogin();
      await refreshRecords();
      maybeOfferDraftRestore();
      return true;
    }catch(err){
      const msg = (err?.message ?? String(err));
      if(/Failed to fetch|NetworkError|CORS/i.test(msg)){
        const text =
          "Login fejlede (forbindelse/CORS).\n\n" +
          "Hvis du kører lokalt (localhost/Live Server), skal backend tillade din origin i CORS.\n" +
          "Alternativt: kør via GitHub Pages/den tilladte URL.\n\n" +
          "Teknisk fejl: " + msg;
        if(showInlineError) setGateError(text);
        else alert(text);
      }else{
        const text = "Login fejlede: " + msg;
        if(showInlineError) setGateError(text);
        else alert(text);
      }
      return false;
    }
  }else{
    // Lokal fallback: gem kun initialer (ingen rigtig sikkerhed)
    localStorage.setItem(USER_KEY, JSON.stringify({ initials: login, role: "user" }));
    setAuth({ token: null, user: { initials: login, role: ROLE_ALLOCATOR } });
    closeLogin();
    renderRecordList();
    maybeOfferDraftRestore();
    return true;
  }
}

async function handleModalLoginSubmit(){
  const initials = normalizeLoginInput(loginInitials.value || "");
  const pin = (loginPin?.value || "").trim();
  await performLogin(initials, pin, { source: "modal" });
}

if(loginForm){
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleModalLoginSubmit();
  });
}else{
  btnLoginSave?.addEventListener("click", handleModalLoginSubmit);
}

btnLogout.addEventListener("click", async () => {
  clearDraft();
  clearAuth();
  closeLogin();
  if(USE_CLOUD){
    recordsCache = [];
    renderRecordList();
  }
});

if(gateLoginForm){
  gateLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const login = normalizeLoginInput(gateLoginInitials?.value || "");
    const pin = (gateLoginPin?.value || "").trim();
    const ok = await performLogin(login, pin, { source: "gate" });
    if(ok && gateLoginPin) gateLoginPin.value = "";
  });
}

[gateLoginInitials, gateLoginPin].forEach(input => {
  input?.addEventListener("input", () => setGateError(""));
});

btnGateTogglePassword?.addEventListener("click", () => {
  if(!gateLoginPin) return;
  const isPassword = gateLoginPin.type === "password";
  gateLoginPin.type = isPassword ? "text" : "password";
  btnGateTogglePassword.textContent = isPassword ? "Skjul" : "Vis";
  btnGateTogglePassword.setAttribute("aria-pressed", isPassword ? "true" : "false");
  gateLoginPin.focus();
});


// ---------- Revision modal wiring ----------
const revModal = document.getElementById("revModal");
const btnRevClose = document.getElementById("btnRevClose");
const btnRevSave = document.getElementById("btnRevSave");
const btnRevCancel = document.getElementById("btnRevCancel");
const revDescEl = document.getElementById("revDesc");
const revCardsEl = document.getElementById("revCards");
const revLastSummaryEl = document.getElementById("revLastSummary");
const revLastChangesEl = document.getElementById("revLastChanges");
const revisionsDockEl = document.querySelector(".revisionsDock");
const btnToggleRevisions = document.getElementById("btnToggleRevisions");

let _revResolve = null;

function openRevModal(prefill = ""){
  if(!revModal) return;
  if(revDescEl) revDescEl.value = prefill || "";
  revModal.setAttribute("aria-hidden", "false");
  setTimeout(() => { try{ revDescEl?.focus(); }catch{} }, 20);
}

function closeRevModal(){
  if(!revModal) return;
  revModal.setAttribute("aria-hidden", "true");
}

function requestRevisionDescription(){
  return new Promise((resolve) => {
    _revResolve = resolve;
    openRevModal("");
  });
}

function requestRevisionDescriptionPrefill(prefill){
  return new Promise((resolve) => {
    _revResolve = resolve;
    openRevModal(String(prefill || ""));
  });
}

function _finishRev(descOrNull){
  if(typeof _revResolve === "function"){
    const r = _revResolve;
    _revResolve = null;
    r(descOrNull);
  }
  closeRevModal();
}

if(revModal){
  const backdrop = revModal.querySelector(".modal__backdrop");
  backdrop?.addEventListener("click", () => _finishRev(null));
}
btnRevClose?.addEventListener("click", () => _finishRev(null));
btnRevCancel?.addEventListener("click", () => _finishRev(null));
btnRevSave?.addEventListener("click", () => _finishRev((revDescEl?.value || "").trim()));
revDescEl?.addEventListener("keydown", (e) => {
  if((e.ctrlKey || e.metaKey) && e.key === "Enter"){
    e.preventDefault();
    _finishRev((revDescEl?.value || "").trim());
  }
});

function setRevisionsCompact(compact){
  if(!revisionsDockEl || !btnToggleRevisions) return;
  revisionsDockEl.classList.toggle("is-compact", !!compact);
  btnToggleRevisions.textContent = compact ? "Vis log" : "Skjul";
  btnToggleRevisions.setAttribute("aria-expanded", compact ? "false" : "true");
  localStorage.setItem("componentFormRevisionsCompact_v1", compact ? "1" : "0");
}

if(btnToggleRevisions){
  btnToggleRevisions.addEventListener("click", () => {
    setRevisionsCompact(!revisionsDockEl?.classList.contains("is-compact"));
  });
}

// ---------- Revisions rendering ----------
function formatRevDate(iso){
  try{
    return new Date(iso).toLocaleString("da-DK", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }catch{
    return String(iso || "");
  }
}

function getRevisionsSorted(rec){
  const arr = Array.isArray(rec?.revisions) ? rec.revisions : [];
  const out = arr.map(r => ({
    at: String(r?.at || ""),
    by: String(r?.by || ""),
    desc: String(r?.desc || ""),
    changes: String(r?.changes || ""),
  }));
  out.sort((a,b) => String(b.at).localeCompare(String(a.at)));
  return out;
}

function lastRevisionString(rec){
  const revs = getRevisionsSorted(rec);
  const r = revs[0];
  if(!r || (!r.at && !r.by && !r.desc)) return "";
  const parts = [formatRevDate(r.at), (r.by || "—"), (r.desc || "")].filter(Boolean);
  return parts.join(", ");
}

function revisionSymbolToStatus(symbol){
  if(symbol === "🟠") return TAG_STATUS.RESERVED;
  if(symbol === "🔴") return TAG_STATUS.RELEASED;
  return TAG_STATUS.ACTIVE;
}

function revisionChipsHtml(changes){
  const text = String(changes || "").trim();
  if(!text) return `<span class="revCard__plain">—</span>`;

  const tokens = [];
  const re = /(\d{1,10}\.\d{1,3})([🔵🟠🔴])?/gu;
  let match;
  while((match = re.exec(text))){
    tokens.push({ tag: match[1], status: revisionSymbolToStatus(match[2] || "") });
  }

  if(!tokens.length){
    return `<div class="revCard__plain">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  }

  return tokens.map(item =>
    `<span class="revChip" data-mark="${item.status}">${escapeHtml(item.tag)}</span>`
  ).join("");
}

function renderRevisions(rec){
  if(!revCardsEl) return;
  const revs = getRevisionsSorted(rec);

  if(!revs.length){
    revCardsEl.innerHTML = `<div class="muted">Ingen ændringer endnu.</div>`;
    if(revLastSummaryEl) revLastSummaryEl.textContent = "—";
    if(revLastChangesEl) revLastChangesEl.textContent = "—";
    return;
  }

  const last = revs[0];
  if(revLastSummaryEl){
    const parts = [formatRevDate(last.at), (last.by || "—"), (last.desc || "")].filter(Boolean);
    revLastSummaryEl.textContent = parts.join(" · ");
  }
  if(revLastChangesEl){
    revLastChangesEl.innerHTML = revisionChipsHtml(last.changes);
  }

  const cards = revs.slice(0, 80).map(r => {
    return `<article class="revCard">` +
      `<div class="revCard__top"><span>${escapeHtml(formatRevDate(r.at))}</span><span class="revCard__by">${escapeHtml(r.by || "—")}</span></div>` +
      `<div class="revCard__desc">${escapeHtml(r.desc || "Ændring")}</div>` +
      `<div class="revCard__changes">${revisionChipsHtml(r.changes)}</div>` +
    `</article>`;
  }).join("");
  revCardsEl.innerHTML = cards;
}


// Admin: user management
const btnAdminCreateUser = document.getElementById("btnAdminCreateUser");
const adminUsersModal = document.getElementById("adminUsersModal");
const btnAdminUsersClose = document.getElementById("btnAdminUsersClose");
const btnAdminUsersRefresh = document.getElementById("btnAdminUsersRefresh");
const adminUsersList = document.getElementById("adminUsersList");
const adminUsersMessage = document.getElementById("adminUsersMessage");
const adminUserForm = document.getElementById("adminUserForm");
const adminUserInitials = document.getElementById("adminUserInitials");
const adminUserEmail = document.getElementById("adminUserEmail");
const adminUserRole = document.getElementById("adminUserRole");
const adminUserPassword = document.getElementById("adminUserPassword");

function setAdminUsersMessage(message = "", tone = "error"){
  if(!adminUsersMessage) return;
  adminUsersMessage.textContent = message;
  adminUsersMessage.dataset.tone = tone;
}

function closeAdminUsersModal(){
  adminUsersModal?.setAttribute("aria-hidden", "true");
  setAdminUsersMessage("");
}

function adminUserRowHtml(user){
  const role = normalizeRole(user?.role);
  const created = user?.created_at ? formatRevDate(user.created_at) : "—";
  const disabled = user?.disabled ? " · deaktiveret" : "";
  return `
    <article class="adminUserRow">
      <div class="adminUserRow__main">
        <strong>${escapeHtml(user?.initials || "—")}</strong>
        <span>${escapeHtml(user?.email || "Ingen email")}</span>
      </div>
      <div class="adminUserRow__meta">
        <span class="rolePill" data-role="${role}">${escapeHtml(roleLabel(role))}${disabled}</span>
        <span>Oprettet ${escapeHtml(created)}</span>
        <span>Af ${escapeHtml(user?.created_by || "—")}</span>
      </div>
    </article>
  `;
}

function renderAdminUsers(users){
  if(!adminUsersList) return;
  const list = Array.isArray(users) ? users : [];
  if(!list.length){
    adminUsersList.innerHTML = `<div class="muted">Ingen brugere fundet.</div>`;
    return;
  }
  adminUsersList.innerHTML = list.map(adminUserRowHtml).join("");
}

async function refreshAdminUsers(){
  if(!adminUsersList) return;
  adminUsersList.innerHTML = `<div class="muted">Indlæser brugere...</div>`;
  setAdminUsersMessage("");
  try{
    const data = await cloudListUsers();
    renderAdminUsers(data?.users || []);
  }catch(err){
    adminUsersList.innerHTML = `<div class="muted">Kunne ikke hente brugere.</div>`;
    setAdminUsersMessage("Kunne ikke hente brugere: " + (err?.message ?? err));
  }
}

async function openAdminUsersModal(){
  const user = requireAdmin("Kun admin kan administrere brugere.");
  if(!user) return;
  adminUsersModal?.setAttribute("aria-hidden", "false");
  await refreshAdminUsers();
}

btnAdminCreateUser?.addEventListener("click", openAdminUsersModal);
btnAdminUsersClose?.addEventListener("click", closeAdminUsersModal);
btnAdminUsersRefresh?.addEventListener("click", refreshAdminUsers);
adminUsersModal?.querySelector(".modal__backdrop")?.addEventListener("click", closeAdminUsersModal);

adminUserForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = requireAdmin("Kun admin kan administrere brugere.");
  if(!user) return;

  const initials = (adminUserInitials?.value || "").trim().toUpperCase();
  const email = (adminUserEmail?.value || "").trim().toLowerCase();
  const role = normalizeRole(adminUserRole?.value || ROLE_USER);
  const password = (adminUserPassword?.value || "").trim();

  if(!initials){
    setAdminUsersMessage("Skriv initialer på brugeren.");
    return;
  }
  if(password.length < 4 || password.length > 64){
    setAdminUsersMessage("Adgangskoden skal være 4-64 tegn.");
    return;
  }

  try{
    setAdminUsersMessage("Gemmer bruger...", "info");
    await cloudCreateUser(initials, password, role, email);
    if(adminUserPassword) adminUserPassword.value = "";
    if(adminUserInitials) adminUserInitials.value = "";
    if(adminUserEmail) adminUserEmail.value = "";
    if(adminUserRole) adminUserRole.value = ROLE_USER;
    await refreshAdminUsers();
    setAdminUsersMessage(`Bruger ${initials} er gemt som ${roleLabel(role)}.`, "success");
  }catch(err){
    setAdminUsersMessage("Kunne ikke gemme bruger: " + (err?.message ?? err));
  }
});

// ---------- Mark/Serie/Filter UI ----------
const markSeg = document.getElementById("markSeg");
if(markSeg){
  markSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".segBtn");
    if(!btn) return;
    setMarkMode(btn.dataset.mark);
  });
}

const seriesSeg = document.getElementById("seriesSeg");
if(seriesSeg){
  seriesSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".segBtn");
    if(!btn) return;
    setSeries(btn.dataset.series);
  });
}

const filterSeg = document.getElementById("filterSeg");
if(filterSeg){
  filterSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".segBtn");
    if(!btn) return;
    setFilterMode(btn.dataset.filter);
  });
}

// PID options update when PID field changes
if(fields.pid){
  fields.pid.addEventListener("input", () => {
    refreshPidOptionsFromField();
    saveDraft("field-change");
  });
}

if(fields.main){
  fields.main.addEventListener("input", () => {
    updateAvailabilityDisplay();
    saveDraft("field-change");
  });
}

[fields.desc, fields.plant, fields.sign1, fields.sign2].forEach(field => {
  field?.addEventListener("input", () => saveDraft("field-change"));
});

// Clickable availability pills (ledig/optaget)
// (Oversigten over ledige numre er kun til overblik og er ikke klikbar)

// Suffix overblik input
if(suffixInputEl){
  suffixInputEl.addEventListener("input", () => {
    currentSuffix = parseSuffixInput(suffixInputEl.value) ?? currentSuffix;
    updateAvailabilityDisplay();
  });
}

// Klik på en serie i suffix-overblikket skifter serie (0xx..9xx)
if(suffixSeriesEl){
  suffixSeriesEl.addEventListener("click", (e) => {
    const p = e.target.closest(".sxPill");
    if(!p) return;
    const s = parseInt(p.dataset.series, 10);
    if(Number.isFinite(s)) setSeries(s);
  });
}

function plannerSaveError(prevRec, rec){
  if(!isPlannerOnly()) return "";
  if(!prevRec){
    const codes = Array.isArray(rec?.selectedCodes) ? rec.selectedCodes.map(String) : [];
    if(!codes.length) return "Planner skal vælge mindst ét orange projektnummer på en ny post.";
    for(const code of codes){
      if(getRecMark(rec, code) !== TAG_STATUS.RESERVED){
        return `Planner kan kun oprette nye poster med orange projektnumre (${formatOpsaetning(code)} er ikke Projekt).`;
      }
    }
    return "";
  }

  const lockedFields = [
    ["hovedkomponentnr", "Hovedkomponentnr."],
    ["beskrivelse", "Beskrivelse"],
    ["anlaeg", "Anlæg"],
    ["pid", "PID Tegningsnr."],
    ["signatur1", "Signatur"],
    ["signatur2", "Signatur"],
  ];

  for(const [key, label] of lockedFields){
    if(String(prevRec?.[key] || "") !== String(rec?.[key] || "")){
      return `Planner kan ikke ændre feltet "${label}". Åbn admin for stamdataændringer.`;
    }
  }

  const oldSet = new Set((prevRec.selectedCodes || []).map(String));
  const newSet = new Set((rec.selectedCodes || []).map(String));
  const all = new Set([...oldSet, ...newSet]);

  for(const code of all){
    const oldHas = oldSet.has(code);
    const newHas = newSet.has(code);
    const oldStatus = oldHas ? getRecMark(prevRec, code) : null;
    const newStatus = newHas ? getRecMark(rec, code) : null;

    if(!oldHas && newHas && newStatus !== TAG_STATUS.RESERVED){
      return `Planner kan kun tilføje orange projektnumre (${formatOpsaetning(code)} er ikke Projekt).`;
    }
    if(oldHas && !newHas && oldStatus !== TAG_STATUS.RESERVED){
      return `Planner kan kun fjerne orange projektnumre (${formatOpsaetning(code)} er ${tagStatusLabel(oldStatus)}).`;
    }
    if(oldHas && newHas && oldStatus !== newStatus){
      return `Planner kan ikke ændre status på ${formatOpsaetning(code)} fra ${tagStatusLabel(oldStatus)} til ${tagStatusLabel(newStatus)}.`;
    }
  }

  return "";
}


// ---------- Buttons ----------
function startNewPost(){
  const user = requireAllocator("Du skal have planner eller admin adgang for at oprette et hovednummer.");
  if(!user) return;
  clearForm();
  if(isPlannerOnly(user)) setMarkMode(TAG_STATUS.RESERVED);
  setEditingEnabled();
}

el("btnNew")?.addEventListener("click", startNewPost);
btnNewSide?.addEventListener("click", startNewPost);

async function saveCurrentRecord(options = {}){
  const mode = options.mode || "manual";
  const isAuto = mode === "auto";
  const user = requireAllocator("Du skal have planner eller admin adgang for at kunne gemme projektændringer.");
  if(!user) return false;

  const v = validateSingleMainNumber(fields.main.value);
  if(!v.ok){
    if(isAuto) updateSyncBadge("Autosave venter på hovednr.");
    else alert(v.message);
    return false;
  }

  // Cloud: avoid duplicates on the same hovedkomponentnr.
  if(USE_CLOUD){
    try{
      await fetchRecordsCache();
    }catch(err){
      const msg = "Kunne ikke hente cloud-poster til dublet-tjek. Prøv igen.\n\n" + (err?.message ?? err);
      if(isAuto) updateSyncBadge("Autosave fejlede: data kunne ikke hentes");
      else alert(msg);
      return false;
    }

    const mainKey = stripLeadingZeros(parseMainNumber(fields.main.value));
    if(mainKey){
      const prevKey = activeId
        ? stripLeadingZeros(parseMainNumber((recordsCache || []).find(r => r.id === activeId)?.hovedkomponentnr))
        : null;

      const conflict = (recordsCache || []).find(r => {
        const k = stripLeadingZeros(parseMainNumber(r?.hovedkomponentnr));
        return k === mainKey && r.id !== activeId;
      });
      if(conflict){
        // Block creating a new duplicate, or changing hovednummer to one that already exists.
        const creatingNew = !activeId;
        const changingMain = (!!activeId && prevKey && prevKey !== mainKey);

        if(creatingNew || changingMain){
          const msg =
            `Der findes allerede en cloud-post med hovednummer ${conflict.hovedkomponentnr}.\n\n` +
            `Du kan ikke gemme samme hovednummer to gange.\n\n` +
            `Vil du åbne den eksisterende post?`;
          if(isAuto){
            updateSyncBadge("Autosave stoppet: dublet hovednr.");
          }else if(confirm(msg)){
            setFormData(conflict);
            renderRecordList();
          }
          return false;
        }

        // Editing an existing post with same hovednummer while duplicates already exist.
        // Allow save, but warn the user.
        if(!isAuto){
          const ok = confirm(
            `OBS: Der findes allerede en anden cloud-post med samme hovednummer (${conflict.hovedkomponentnr}).\n` +
            `Det kan give forvirring.\n\nVil du gemme denne post alligevel?`
          );
          if(!ok) return false;
        }
      }
    }
  }

  const prevRec = activeId ? loadRecords().find(r => r.id === activeId) : null;

  const rec = getFormData();
  const plannerError = plannerSaveError(prevRec, rec);
  if(plannerError){
    if(isAuto) updateSyncBadge("Autosave stoppet: rettighed mangler");
    else alert(plannerError);
    return false;
  }
  const changes = computeTagChanges(prevRec, rec);

  let revDesc = "";
  if(isAuto){
    revDesc = options.description || firstRevisionLine(changes) || "Auto: statusændring";
  }else{
    const desc = await requestRevisionDescription();
    if(desc === null) return false;
    revDesc = String(desc || "").trim();
    if(!revDesc){
      alert("Skriv en kort beskrivelse (fx projektnr.).");
      return false;
    }
  }

  if(!Array.isArray(rec.revisions)) rec.revisions = [];
  rec.revisions.push({ at: rec.updatedAt, by: user.initials, desc: revDesc, changes });

  try{
    await upsertRecord(rec);
    activeId = rec.id;
    const savedRec = loadRecords().find(r => r.id === rec.id) || rec;
    loadedRecordUpdatedAt = savedRec.updatedAt || rec.updatedAt || null;
    renderRecordList();
    changeBuffer = [];
    clearDraft();
    setEditingEnabled();

    // Audit: gem-hændelse
    await logAudit({
      action: "SAVE",
      record_id: rec.id,
      hovednr: rec.hovedkomponentnr || null,
      meta: { selectedCount: (rec.selectedCodes||[]).length, revision: revDesc, changes }
    });

    renderRevisions(savedRec);
    if(isAuto){
      updateSyncBadge(USE_CLOUD ? "Autosave gemt" : "Autosave gemt lokalt");
    }else{
      alert(USE_CLOUD ? "Gemt (cloud)." : "Gemt lokalt.");
    }
    return true;
  }catch(err){
    if(err?.status === 409){
      if(isAuto) updateSyncBadge("Autosave stoppet: posten er ændret af en anden");
      else alert("Posten er ændret af en anden bruger siden du åbnede den. Tryk Opdater data og åbn posten igen, før du gemmer.");
      return false;
    }
    if(isAuto) updateSyncBadge("Autosave fejlede");
    else alert("Kunne ikke gemme: " + (err?.message ?? err));
    return false;
  }
}

function firstRevisionLine(changes){
  return String(changes || "").split(/\n+/).map(s => s.trim()).filter(Boolean)[0] || "";
}

function scheduleAutoSave(reason = "status-change"){
  if(!changeBuffer.length) return;
  const user = getCurrentUser();
  if(!user || !canSaveRecords(user)) return;

  saveDraft(reason);
  updateSyncBadge("Autosave venter...");
  autoSaveQueued = true;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(runQueuedAutoSave, 1200);
}

async function runQueuedAutoSave(){
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;

  if(autoSaveInFlight){
    autoSaveQueued = true;
    return;
  }
  if(!autoSaveQueued || !changeBuffer.length) return;

  autoSaveQueued = false;
  autoSaveInFlight = true;
  updateSyncBadge("Autosave gemmer...");
  try{
    await saveCurrentRecord({ mode: "auto" });
  }finally{
    autoSaveInFlight = false;
    if(autoSaveQueued && changeBuffer.length){
      scheduleAutoSave("status-change");
    }
  }
}

el("btnSave").addEventListener("click", async () => {
  await saveCurrentRecord({ mode: "manual" });
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
  const mainRaw = (fields.main.value || "").trim();
  const vMain = validateSingleMainNumber(mainRaw);
  if(!vMain.ok){ alert(vMain.message); return; }
  const main = parseMainNumber(mainRaw);
  const desc = (fields.desc.value || "").trim();
  const plant = (fields.plant.value || "").trim();
  const pid = (fields.pid.value || "").trim();
  const signHeader = [ (fields.sign1.value||"").trim(), formatDateValue(getDateFieldValue(fields.sign2)) ].filter(Boolean).join("; ");
  const revStr = activeId ? (lastRevisionString(loadRecords().find(r => r.id === activeId) || null) || "") : "";

  const codes = getSelectedCodes();
  if(!main){
    alert("Udfyld først 'Hovedkomponentnr.' (start med tal, fx 00075) før eksport.");
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
    const meta = codeMeta?.[code] || {};
    const signature = meta?.by || signHeader || "—";
    const mark = normalizeTagStatus(meta.mark || TAG_STATUS.ACTIVE);
    const statusLabel = `${tagStatusSymbol(mark)} ${tagStatusLabel(mark)}`;
    const sourceLabel = isScanSourceForCode(code) ? "Scan/import" : "Manuel";
    const ops = formatOpsaetning(code);
    const tag = buildTag(mainRaw, code);

    return {
      "Hovedkomponentnr.": main,     // gem som tekst (bevarer evt. foranstillede 0'er)
      "Beskrivelse": desc,
      "Anlæg": plant,
      "PID Tegningsnr.": pid,
      "PID (tag)": String(meta.pid || pid || "").trim(),
      "Signatur": signature,
      "Opsætning": ops,              // 01 / 101 / 201 ...
      "Status": statusLabel,         // I brug / Projekt / Frigivet
      "Kilde": sourceLabel,          // Manuel / Scan-import
      "Tag": tag,                    // 27.01 / 27.101 ...
      "Revision": revStr,
    };
  });

  const headers = [
    "Hovedkomponentnr.",
    "Beskrivelse",
    "Anlæg",
    "PID Tegningsnr.",
    "PID (tag)",
    "Signatur",
    "Opsætning",
    "Status",
    "Kilde",
    "Tag",
    "Revision",
  ];

  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });

  // Tving tekst-format på kolonner der ellers kan blive tolket som tal/dato (bevarer 00075 + 27.01)
  const colIndex = {
    hoved: headers.indexOf("Hovedkomponentnr."),
    ops: headers.indexOf("Opsætning"),
    tag: headers.indexOf("Tag"),
  };
  for(let r = 1; r <= rows.length; r++){
    for(const c of [colIndex.hoved, colIndex.ops, colIndex.tag]){
      const addr = XLSX.utils.encode_cell({ r, c });
      if(ws[addr]){
        ws[addr].t = "s";
        ws[addr].v = String(ws[addr].v ?? "");
      }
    }
  }

  // Make columns a bit wider
  ws["!cols"] = [
    { wch: 18 },
    { wch: 40 },
    { wch: 16 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 44 },
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


// ---------- Print (valgte poster) ----------
function codeKeyForSeriesN(i, series){
  return (series === 0) ? pad2(i) : String(series * 100 + i);
}
function displayNumberForSeriesN(i, series){
  return (series === 0) ? pad2(i) : String(series * 100 + i);
}
function formatRangeLabelForSeries(rangeStr, series){
  const {a,b} = parseRange(rangeStr);
  const off = series * 100;
  const A = off + a;
  const B = off + b;
  const fmt = (n) => (series === 0 ? pad2(n) : String(n));
  return `${fmt(A)} - ${fmt(B)}`;
}

function buildGridForPrint(gridEl, series, rec, selectedSet){
  const {a,b} = parseRange(gridEl.dataset.range);
  gridEl.innerHTML = "";

  // Special for 01-29 (samme layout i alle serier)
  if(a === 1 && b === 29){
    const spacer = document.createElement("div");
    spacer.className = "gridSpacer";
    gridEl.appendChild(spacer);
  }

  const sources = (rec?.codeSources && typeof rec.codeSources === "object") ? rec.codeSources : {};
  const metaMap = (rec?.codeMeta && typeof rec.codeMeta === "object") ? rec.codeMeta : {};
  const multiPid = (parsePidList(rec?.pid).length > 1);

  for(let i=a;i<=b;i++){
    const wrap = document.createElement("label");
    wrap.className = "item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "cb";
    cb.disabled = true;
    cb.setAttribute("disabled", "");

    const codeKey = codeKeyForSeriesN(i, series);
    cb.dataset.code = codeKey;

    const isChecked = selectedSet.has(codeKey);
    if(isChecked){
      cb.checked = true;
      cb.setAttribute("checked", "");

      const meta = metaMap?.[codeKey] || {};
      const src = sources?.[codeKey] || meta.source || "manual";
      const mark = meta.mark || (src === "scan" ? "scan" : "blue");
      cb.dataset.mark = mark;

      if(multiPid){
        const pidColor = (meta.pidColor ?? (Number.isFinite(parseInt(meta.pidIdx,10)) ? (parseInt(meta.pidIdx,10) % 4) : 0));
        cb.dataset.pid = String(pidColor);
      }
    }

    const code = document.createElement("span");
    code.className = "code";
    code.textContent = displayNumberForSeriesN(i, series);

    wrap.appendChild(cb);
    wrap.appendChild(code);
    gridEl.appendChild(wrap);
  }
}

function buildPaperForPrint(rec, series){
  const base = document.getElementById("paper");
  if(!base) return null;

  const p = base.cloneNode(true);
  p.removeAttribute("id");

  // Set top fields (as attributes so they show in print)
  const setVal = (sel, val) => {
    const elx = p.querySelector(sel);
    if(!elx) return;
    const v = String(val ?? "");
    elx.value = v;
    elx.setAttribute("value", v);
  };
  setVal('#fMain', rec?.hovedkomponentnr ?? '');
  setVal('#fDesc', rec?.beskrivelse ?? '');
  setVal('#fPlant', rec?.anlaeg ?? '');
  setVal('#fPid', rec?.pid ?? '');
  setVal('#fSign1', rec?.signatur1 ?? '');
  setVal('#fSign2', normalizeDateInputValue(rec?.signatur2 ?? '') || '');

  // Series-specific layout tweaks
  if(series !== 0){
    p.classList.add('paper--series-nz');
  }

  const selectedSet = new Set((rec?.selectedCodes || []).map(String));

  // Update range labels + rebuild grids
  const sections = Array.from(p.querySelectorAll('.section'));
  for(const sec of sections){
    const grid = sec.querySelector('.grid');
    if(!grid) continue;

    const span = sec.querySelector('.secRange');
    if(span){
      span.textContent = formatRangeLabelForSeries(grid.dataset.range, series);
    }

    buildGridForPrint(grid, series, rec, selectedSet);
  }

  // Add a small series badge (helps when printing mixed series)
  const badge = document.createElement('div');
  badge.className = 'printSeriesBadge muted';
  badge.textContent = series === 0 ? 'Serie: 0xx' : `Serie: ${series}xx`;
  p.appendChild(badge);

  return p;
}

async function printSelectedRecords(){
  if(USE_CLOUD){
    try{ await refreshRecords(); }catch{}
  }

  const ids = Array.from(selectedRecordIds || []);
  if(ids.length === 0){
    alert("Markér en eller flere poster i venstre liste (checkbox).\nTip: Du kan bruge 'Markér alle'.");
    return;
  }

  // Optional: ask for number of copies per record
  let copies = 1;
  try{
    const ans = prompt('Antal kopier pr. hovednr.? (1 = standard)', '1');
    if(ans !== null && String(ans).trim() !== ''){
      const n = parseInt(ans, 10);
      if(Number.isFinite(n) && n >= 1 && n <= 10) copies = n;
    }
  }catch{}

  const all = loadRecords();
  const byId = new Map(all.map(r => [r.id, r]));
  let recs = ids.map(id => byId.get(id)).filter(Boolean);

  // If active record is selected, print the current in-memory version
  if(activeId && selectedRecordIds.has(activeId)){
    try{
      const current = getFormData();
      recs = recs.map(r => (r.id === activeId ? current : r));
    }catch{}
  }

  const pages = [];

  for(const rec of recs){
    const codes = Array.isArray(rec?.selectedCodes) ? rec.selectedCodes.map(String) : [];
    const seriesSet = new Set();
    for(const c of codes){
      const n = parseInt(c,10);
      if(!Number.isFinite(n)) continue;
      seriesSet.add(n >= 100 ? Math.floor(n/100) : 0);
    }

    let seriesList = Array.from(seriesSet).sort((a,b)=>a-b);
    if(seriesList.length === 0){
      // No selections -> still print one 0xx page with header filled
      seriesList = [0];
    }

    for(let k=0;k<copies;k++){
      for(const series of seriesList){
        const p = buildPaperForPrint(rec, series);
        if(!p) continue;
        const wrap = document.createElement('div');
        wrap.className = 'printPage';
        wrap.appendChild(p);
        pages.push(wrap);
      }
    }
  }

  if(pages.length === 0){
    alert('Ingen sider at printe.');
    return;
  }

  // Collect CSS (inline for robust printing)
  let cssText = '';
  try{
    const r = await fetch('./styles.css', { cache: 'no-store' });
    if(r.ok) cssText = await r.text();
  }catch{}

  const extraCss = `
    body{ background:#fff !important; }
    .printPage{ page-break-after: always; }
    .printPage:last-child{ page-break-after: auto; }
    .printPage .paper{ margin: 0 auto 16px; }
    .paper{ box-shadow:none !important; position:relative; }
    .paper--series-nz .grid{ column-gap: 18px; }
    .paper--series-nz .grid .item{ gap: 6px; }
    .printSeriesBadge{ position:absolute; right:18px; top:14px; font-size:12px; }
  `;

  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Print</title>
    <style>${cssText}
${extraCss}</style>
  </head><body></body></html>`;

  const w = window.open('', '_blank');
  if(!w){
    alert('Popup blev blokeret. Tillad popups for at kunne printe.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();

  // Append pages once window is ready
  const mount = () => {
    try{
      const body = w.document.body;
      for(const page of pages){
        // Import nodes into the new window document
        body.appendChild(w.document.importNode(page, true));
      }
      w.focus();
      // Wait a tick so layout is ready before printing
      setTimeout(() => { try{ w.print(); }catch{} }, 250);
    }catch(err){
      alert('Kunne ikke bygge print-visning: ' + (err?.message ?? err));
    }
  };

  if(w.document.readyState === 'complete') mount();
  else w.onload = mount;
}


function forceExcelTextColumns(ws, headers, rowCount){
  const colIndex = {
    hoved: headers.indexOf("Hovedkomponentnr."),
    ops: headers.indexOf("Opsætning"),
    tag: headers.indexOf("Tag"),
  };
  for(let r = 1; r <= rowCount; r++){
    for(const c of [colIndex.hoved, colIndex.ops, colIndex.tag]){
      if(c < 0) continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      if(ws[addr]){
        ws[addr].t = "s";
        ws[addr].v = String(ws[addr].v ?? "");
      }
    }
  }
}

function makeSafeSheetName(raw, used){
  let name = String(raw || "Post").trim();
  name = name.replace(/[\\/?*\[\]:]/g, "_"); // Excel invalid chars
  if(!name) name = "Post";
  name = name.slice(0, 31);

  let out = name;
  let i = 1;
  while(used.has(out)){
    const suffix = "_" + i++;
    out = name.slice(0, Math.max(0, 31 - suffix.length)) + suffix;
  }
  used.add(out);
  return out;
}

function rowsFromRecordForExcel(rec){
  const mainRaw = String(rec?.hovedkomponentnr || "").trim();
  const main = parseMainNumber(mainRaw);
  if(!main) return [];

  const desc = String(rec?.beskrivelse || "").trim();
  const plant = String(rec?.anlaeg || "").trim();
  const pid = String(rec?.pid || "").trim();
  const signHeader = [ String(rec?.signatur1 || "").trim(), formatDateValue(rec?.signatur2 || "") ].filter(Boolean).join("; ");

  const codes = Array.isArray(rec?.selectedCodes) ? rec.selectedCodes.map(String) : [];
  codes.sort((a,b)=>parseInt(a,10)-parseInt(b,10));

  const sources = (rec?.codeSources && typeof rec.codeSources === "object") ? rec.codeSources : {};
  const metaMap = (rec?.codeMeta && typeof rec.codeMeta === "object") ? rec.codeMeta : {};

  return codes.map(code => {
    const meta = metaMap?.[code] || {};
    const src = sources?.[code] || meta.source || "manual";
    const mark = normalizeTagStatus(meta.mark || TAG_STATUS.ACTIVE);
    const statusLabel = `${tagStatusSymbol(mark)} ${tagStatusLabel(mark)}`;
    const sourceLabel = isScanSourceValue(src, meta.source || meta.mark) ? "Scan/import" : "Manuel";
    const signature = meta.by || signHeader || rec.editedBy || "—";
    const ops = formatOpsaetning(code);
    const tag = buildTag(mainRaw, code);

    return {
      "Hovedkomponentnr.": main,
      "Beskrivelse": desc,
      "Anlæg": plant,
      "PID Tegningsnr.": pid,
      "PID (tag)": String(meta.pid || pid || "").trim(),
      "Signatur": signature,
      "Opsætning": ops,
      "Status": statusLabel,
      "Kilde": sourceLabel,
      "Tag": tag,
      "Revision": lastRevisionString(rec) || "",
    };
  });
}

async function exportExcelFromSelectedRecords(){
  if(typeof XLSX === "undefined"){
    alert("Excel-biblioteket (XLSX) er ikke indlæst. Tjek internetforbindelse eller CDN-link i index.html.");
    return;
  }

  if(USE_CLOUD){
    try{ await refreshRecords(); }catch{}
  }

  const ids = Array.from(selectedRecordIds || []);
  if(ids.length === 0){
    alert("Markér en eller flere poster i venstre liste (checkbox) eller tryk 'Markér alle'.");
    return;
  }

  const all = loadRecords();
  const byId = new Map(all.map(r => [r.id, r]));

  let recs = ids.map(id => byId.get(id)).filter(Boolean);

  // Hvis den aktive post er markeret, så brug de aktuelle felter (også hvis den ikke er gemt endnu)
  if(activeId && selectedRecordIds.has(activeId)){
    try{
      const current = getFormData();
      recs = recs.map(r => (r.id === activeId ? current : r));
    }catch{
      // ignore
    }
  }

  const headers = [
    "Hovedkomponentnr.",
    "Beskrivelse",
    "Anlæg",
    "PID Tegningsnr.",
    "PID (tag)",
    "Signatur",
    "Opsætning",
    "Status",
    "Kilde",
    "Tag",
    "Revision",
  ];

  const sheets = [];
  const usedNames = new Set();
  let allRows = [];

  for(const rec of recs){
    const rows = rowsFromRecordForExcel(rec);
    if(!rows.length) continue;

    allRows.push(...rows);

    const main = parseMainNumber(rec.hovedkomponentnr || "") || "Post";
    const sheetName = makeSafeSheetName(main, usedNames);

    sheets.push({ name: sheetName, rows });
  }

  if(allRows.length === 0){
    alert("Ingen valgte poster indeholder markerede felter at eksportere.");
    return;
  }

  const wb = XLSX.utils.book_new();

  // Samlet ark
  const wsAll = XLSX.utils.json_to_sheet(allRows, { header: headers });
  forceExcelTextColumns(wsAll, headers, allRows.length);
  wsAll["!cols"] = [
    { wch: 18 },
    { wch: 40 },
    { wch: 16 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 44 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAll, makeSafeSheetName("Alle", usedNames));

  // Ét ark pr. hovednummer
  for(const s of sheets){
    const ws = XLSX.utils.json_to_sheet(s.rows, { header: headers });
    forceExcelTextColumns(ws, headers, s.rows.length);
    ws["!cols"] = wsAll["!cols"];
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }

  const today = new Date();
  const y = String(today.getFullYear());
  const m = String(today.getMonth()+1).padStart(2,"0");
  const d = String(today.getDate()).padStart(2,"0");
  const filename = `komponent-blanketter_valgte_${y}-${m}-${d}.xlsx`;

  XLSX.writeFile(wb, filename);
}


el("btnPrint")?.addEventListener("click", () => window.print());

function localDateStampForFilename(date = new Date()){
  const y = String(date.getFullYear());
  const m = String(date.getMonth()+1).padStart(2,"0");
  const d = String(date.getDate()).padStart(2,"0");
  const hh = String(date.getHours()).padStart(2,"0");
  const mm = String(date.getMinutes()).padStart(2,"0");
  return `${y}-${m}-${d}_${hh}${mm}`;
}

function buildJsonBackupPayload(records){
  const user = getCurrentUser();
  const cleanRecords = (Array.isArray(records) ? records : []).map(stripClientOnlyRecordFields);
  return {
    schema: "komponentdatabase.backup.v2",
    exportedAt: new Date().toISOString(),
    source: USE_CLOUD ? "cloud" : "local",
    exportedBy: user?.initials || null,
    count: cleanRecords.length,
    records: cleanRecords,
  };
}

el("btnExport").addEventListener("click", async () => {
  if(!requireAdmin("Kun admin kan eksportere JSON backup.")) return;
  if(USE_CLOUD){
    try{ await refreshRecords(); }catch{}
  }
  const records = loadRecords();
  const backup = buildJsonBackupPayload(records);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `komponentdatabase-backup-${localDateStampForFilename()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

el("btnExportExcel")?.addEventListener("click", exportExcelFromCurrent);

if(btnExportExcelSelected){
  btnExportExcelSelected.addEventListener("click", exportExcelFromSelectedRecords);
}

if(btnPrintSelected){
  btnPrintSelected.addEventListener("click", printSelectedRecords);
}

searchEl.addEventListener("input", renderRecordList);

// Initialize
(async function init(){
  // Label UI depending on mode
  const btnSave = el("btnSave");
  const btnLoad = el("btnLoad");
  const title = document.querySelector(".sidebar__title");
  const hint = document.querySelector(".hint");
  if(searchModeHintEl) searchModeHintEl.textContent = USE_CLOUD ? "Cloud" : "Lokal";

  if(USE_CLOUD){
    if(btnSave) btnSave.textContent = "Gem ændringer";
    if(btnLoad) btnLoad.textContent = "Opdater data";
    if(title) title.textContent = "Søg";
    if(hint){
      hint.innerHTML = `
        <div><strong>Søgning:</strong> Find hovednr., PID eller et fuldt tag.</div>
        <div>VIEW kan se. PLAN kan reservere orange projektnumre. ADMIN kan vedligeholde data.</div>
      `;
    }
  }else{
    if(btnSave) btnSave.textContent = "Gem ændringer";
    if(btnLoad) btnLoad.textContent = "Opdater data";
    if(title) title.textContent = "Søg";
  }

  updateUserBadge();
  setRevisionsCompact(localStorage.getItem("componentFormRevisionsCompact_v1") !== "0");
  setMarkMode(currentMark);
  setFilterMode(currentFilter);
  setSeries(currentSeries);
  renderRevisions(null);
  refreshPidOptionsFromField();

  if(USE_CLOUD && getCurrentUser()){
    try{
      const me = await cloudMe();
      setAuth({ token: getToken(), user: { initials: me.initials, role: me.role, email: me.email || "" } });
      await refreshRecords();
      maybeOfferDraftRestore();
    }catch(err){
      if(/Unauthorized|Forbidden|Unknown user/i.test(err?.message || "")){
        clearAuth();
        recordsCache = [];
      }
      renderRecordList();
    }
  }else{
    renderRecordList();
  }
})();
