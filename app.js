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
const availableCodesEl = el("availableCodes");
const availCountEl = el("availCount");
const suffixInputEl = el("suffixInput");
const suffixSeriesEl = el("suffixSeries");
const recordListEl = el("recordList");
const searchEl = el("search");

// Sidebar multi-select + export
const btnSelectAllVisible = document.getElementById("btnSelectAllVisible");
const btnSelectNone = document.getElementById("btnSelectNone");
const btnExportExcelSelected = document.getElementById("btnExportExcelSelected");
const btnPrintSelected = document.getElementById("btnPrintSelected");
const selectedRecordCountEl = document.getElementById("selectedRecordCount");

let selectedRecordIds = new Set();

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


// ---------- Markering (blå/rød) + Serie (0xx..9xx) ----------
let currentMark = "blue";   // "blue" | "red"
let currentSeries = 0;      // 0..9 (0xx, 1xx, ...)
let currentFilter = "all"; // "all" | "blue" | "red" | "scan"

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

function markSymbol(mark){
  if(mark === "red") return "🔴";
  if(mark === "scan") return "🟩";
  return "🔵";
}

function getRecMark(rec, code){
  if(!rec) return "blue";
  const src = rec.codeSources || {};
  const meta = rec.codeMeta || {};
  return meta?.[code]?.mark || (src?.[code] === "scan" ? "scan" : "blue");
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

function computeTagChanges(prevRec, currRec){
  if(!currRec) return "";
  const main = currRec.hovedkomponentnr || "";
  const showPid = (parsePidList(currRec.pid || "").length > 1);

  const prevSel = new Set(prevRec?.selectedCodes || []);
  const currSel = new Set(currRec.selectedCodes || []);

  const added = [];
  const removed = [];
  const changed = [];

  // Added & changed
  for(const code of currRec.selectedCodes || []){
    if(!prevSel.has(code)){
      const tag = buildTag(main, code);
      added.push(formatChangeItem(tag, getRecMark(currRec, code), getRecPid(currRec, code), showPid));
    }else{
      // present in both: check mark/pid changes
      const m0 = getRecMark(prevRec, code);
      const m1 = getRecMark(currRec, code);
      const p0 = getRecPid(prevRec, code);
      const p1 = getRecPid(currRec, code);

      const tag = buildTag(main, code);
      const parts = [];

      if(m0 !== m1){
        parts.push(`${markSymbol(m0)}→${markSymbol(m1)}`);
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
      removed.push(formatChangeItem(tag, getRecMark(prevRec, code), getRecPid(prevRec, code), showPid));
    }
  }

  if(!prevRec){
    if(!added.length) return "Oprettet (ingen tags valgt).";
    return `Oprettet\nTilføjet: ${added.join(", ")}`;
  }

  const lines = [];
  if(added.length) lines.push(`Tilføjet: ${added.join(", ")}`);
  if(removed.length) lines.push(`Fjernet: ${removed.join(", ")}`);
  if(changed.length) lines.push(`Ændret: ${changed.join(", ")}`);
  if(!lines.length) return "Ingen tag-ændringer.";
  return lines.join("\n");
}


function getMarkForCode(code){
  const src = codeSource[code] || "manual";
  const meta = codeMeta?.[code] || {};
  return meta.mark || (src === "scan" ? "scan" : "blue");
}

function setMarkMode(mark){
  currentMark = (mark === "red") ? "red" : "blue";
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
  const allowed = new Set(["all","blue","red","scan"]);
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
  // Ensure newly built checkboxes follow login state
  setEditingEnabled(!!getCurrentUser());
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
  let blue = 0, red = 0, scan = 0;
  const sources = rec.codeSources || {};
  const meta = rec.codeMeta || {};
  (rec.selectedCodes || []).forEach(code => {
    const mark = (meta?.[code]?.mark) || ((sources[code] === "scan") ? "scan" : "blue");
    if(mark === "red") red++;
    else if(mark === "scan") scan++;
    else blue++;
  });
  return {blue, red, scan};
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
    cb.disabled = !getCurrentUser();

    // Right-click: force red mark without unchecking
    cb.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const user = getCurrentUser();
      if(!user){
        requireLogin("Du skal være logget ind for at kunne sætte krydser.");
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

      const now = new Date().toISOString();

      if(cb.checked){
        codeSource[codeKey] = "manual";
        codeMeta[codeKey] = {
          by: user.initials,
          at: now,
          source: "manual",
          mark: currentMark,
          pid: getCurrentPidValue(),
          pidIdx: currentPidIdx,
          pidColor: (pidOptions.length > 1) ? (currentPidIdx % 4) : 0,
        };
        changeBuffer.push({ at: now, by: user.initials, action: "CHECK", code: codeKey, source: "manual", mark: currentMark });
      }else{
        delete codeSource[codeKey];
        delete codeMeta[codeKey];
        changeBuffer.push({ at: now, by: user.initials, action: "UNCHECK", code: codeKey, source: "manual" });
      }

      updateSelectedCodes();

      const mainRaw = (fields.main.value || "").trim();
      logAudit({
        action: cb.checked ? "CHECK" : "UNCHECK",
        record_id: activeId,
        hovednr: parseMainNumber(mainRaw) || null,
        opsaetning: parseInt(codeKey, 10),
        tag: buildTag(mainRaw, codeKey) || null,
        meta: { source: "manual", mark: cb.checked ? currentMark : null, pid: cb.checked ? getCurrentPidValue() : null }
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
    const m = (source === "scan") ? "scan" : (mark || prev.mark || "blue");
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
    : allCodes.filter(code => getMarkForCode(code) === currentFilter);

  if(!allCodes.length){
    selectedCodesEl.textContent = "—";
  }else if(!codes.length){
    selectedCodesEl.innerHTML = `<span class="muted">Ingen i filter</span>`;
  }else{
    const pills = codes.map(code => {
      const mark = getMarkForCode(code);
      const meta = codeMeta?.[code] || {};
      const pidColor = (pidOptions.length > 1) ? (meta.pidColor ?? ((meta.pidIdx ?? 0) % 4)) : null;
      const label = formatOpsaetning(code);
      const pidAttr = (pidOptions.length > 1) ? ` data-pid="${pidColor}"` : "";
      const pidDot = (pidOptions.length > 1) ? `<span class="pillPidDot"></span>` : "";
      return `<span class="pill" data-mark="${mark}"${pidAttr}><span class="pillDot"></span>${pidDot}${label}</span>`;
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
      const mark = meta.mark || (src === "scan" ? "scan" : "blue");

      cb.dataset.mark = mark;

      // PID (kun hvis flere PID-numre)
      if(pidOptions.length > 1){
        const pidColor = meta.pidColor ?? ((meta.pidIdx ?? 0) % 4);
        cb.dataset.pid = String(pidColor);
      }else{
        delete cb.dataset.pid;
      }

      // Filter: dim selected checkboxes that don't match
      if(currentFilter !== "all" && mark !== currentFilter) cb.dataset.dim = "1";
      else delete cb.dataset.dim;

      if(meta?.by){
        const when = meta.at ? new Date(meta.at).toLocaleString() : "";
        const pidTxt = (meta.pid && pidOptions.length > 1) ? ` — PID ${meta.pid}` : "";
        cb.title = `${meta.by}${when ? " — " + when : ""}${meta.source ? " (" + meta.source + ")" : ""}${meta.mark ? " — " + meta.mark : ""}${pidTxt}`;
      }else{
        cb.removeAttribute("title");
      }
    }else{
      delete cb.dataset.mark;
      delete cb.dataset.dim;
      delete cb.dataset.pid;
      cb.removeAttribute("title");
    }
  });

  updateAvailabilityDisplay();
}

function getUsedCodesInOtherRecords(mainRaw, excludeId){
  const main = stripLeadingZeros(parseMainNumber(mainRaw));
  if(!main) return new Set();
  const used = new Set();
  for(const r of loadRecords() || []){
    if(!r || !r.hovedkomponentnr) continue;
    if(excludeId && r.id === excludeId) continue;
    const m = stripLeadingZeros(String(r.hovedkomponentnr));
    if(m !== main) continue;
    (r.selectedCodes || []).forEach(c => used.add(String(c)));
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
    if(suffixSeriesEl) suffixSeriesEl.textContent = "—";
    return;
  }

  const usedOther = getUsedCodesInOtherRecords(mainRaw, activeId);

  let freeCount = 0;
  let takenCount = 0;
  const freeNums = [];

  for(let i=1;i<=99;i++){
    const codeKey = codeKeyForSeries(i);
    const isSel = !!codeSource[codeKey];
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
    const isTaken = !isSel && usedOther.has(codeKey);
    const state = isSel ? "selected" : (isTaken ? "taken" : "free");
    let markAttr = "";
    if(isSel){
      const mark = getMarkForCode(codeKey);
      markAttr = ` data-mark="${mark}"`;
    }
    pills.push(`<span class="sxPill" data-series="${s}" data-state="${state}"${markAttr}><span class="sxPillDot"></span>${s}xx</span>`);
  }
  suffixSeriesEl.innerHTML = pills.join("");
}

function applyCheckChange(codeKey, checked, markOverride=null){
  const user = getCurrentUser();
  if(!user){
    requireLogin("Du skal være logget ind for at kunne sætte krydser.");
    return;
  }

  const now = new Date().toISOString();
  const mark = markOverride || currentMark;
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
  changeBuffer = [];
  codeMeta = {};
  fields.main.value = "";
  fields.desc.value = "";
  fields.plant.value = "";
  fields.pid.value = "";
  refreshPidOptionsFromField();
  fields.sign1.value = "";
  fields.sign2.value = "";
  setSelectedCodes([]);
  renderRevisions(null);
  renderRecordList();
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
    signatur2: fields.sign2.value.trim(),
    selectedCodes: getSelectedCodes(),
    codeSources: {...codeSource},          // per code: scan/manual
    codeMeta: {},                          // filled below
    editedBy: user?.initials ?? "—",
    updatedAt: nowIso,
    audit: Array.isArray(existing?.audit) ? [...existing.audit] : [],
    revisions: Array.isArray(existing?.revisions) ? [...existing.revisions] : [],
  };

  // Keep only metadata for selected codes; add defaults if missing
  const selSet = new Set(rec.selectedCodes);
  const metaOut = {};
  for(const code of rec.selectedCodes){
    if(codeMeta[code]){
      const src = (codeSource[code] || codeMeta[code].source || "manual");
      metaOut[code] = { ...codeMeta[code], source: src, mark: codeMeta[code].mark || (src === "scan" ? "scan" : "blue") };
    }else{
      metaOut[code] = {
        by: user?.initials ?? "—",
        at: nowIso,
        source: (codeSource[code] || "manual"),
        mark: (codeSource[code] === "scan") ? "scan" : "blue",
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
  refreshPidOptionsFromField();
  fields.sign1.value = rec.signatur1 ?? "";
  fields.sign2.value = rec.signatur2 ?? "";

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
    const mark = prev.mark || (src === "scan" ? "scan" : "blue");

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

// Fetch records into cache (cloud) without changing the current UI state.
async function fetchRecordsCache(){
  if(!USE_CLOUD) return;
  const user = getCurrentUser();
  if(!user) { recordsCache = []; return; }
  const data = await apiFetch("/records", { method: "GET" });
  recordsCache = Array.isArray(data?.records) ? data.records : [];
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
  await fetchRecordsCache();
  renderRecordList();
  updateAvailabilityDisplay();
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
    badge.textContent = `${nSel} felter (🔵${mk.blue} 🔴${mk.red} 🟩${mk.scan})`;

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

// Import Excel (.xls/.xlsx) med kolonnen 'NR' (tags)
const excelTagsFile = document.getElementById("excelTagsFile");
const btnImportExcelTags = document.getElementById("btnImportExcelTags");

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

  const user = requireLogin("Du skal være logget ind for at importere Excel (det opretter/ajourfører poster og logger initialer). ");
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
      alert("Fandt ingen gyldige tags i Excel-filen.\n\nForventet format: 4390.002 (kolonne 'NR').");
      return;
    }

    const totalTags = [...groups.values()].reduce((sum,g) => sum + g.codes.size, 0);
    const ok = confirm(
      `Fandt ${totalTags} tags fordelt på ${groups.size} hovednumre.\n` +
      `Importerede tags markeres som 'Fra scan (grøn)'.\n\n` +
      `Vil du oprette/ajourføre posterne nu?`
    );
    if(!ok) return;

    const desc = await requestRevisionDescriptionPrefill("Excel import");
    if(desc === null) return;
    const revDesc = String(desc || "").trim() || "Excel import";

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

          // Markér som scan (grøn)
          rec.codeSources[c] = "scan";
          rec.codeMeta[c] = {
            by: user.initials,
            at: nowIso,
            source: "scan",
            mark: "scan",
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
              mark: (rec.codeSources[c] === "scan") ? "scan" : "blue",
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
      `Excel import færdig.\n` +
      `Oprettet: ${created}\n` +
      `Opdateret: ${updated}\n` +
      `Tilføjede tags: ${addedTotal}\n` +
      (invalidCount ? `\nUgyldige rækker/tags (ignoreret): ${invalidCount}` : "") +
      (dupWarnings ? `\n\nOBS: Der findes allerede dubletter på ${dupWarnings} post(er) i cloud for samme hovednr. (import brugte den første).` : "");

    alert(msg);

  }catch(err){
    alert("Kunne ikke importere Excel: " + (err?.message ?? err));
  }
}

if(btnImportExcelTags && excelTagsFile){
  btnImportExcelTags.addEventListener("click", () => excelTagsFile.click());

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

  const user = requireLogin("Du skal være logget ind for at køre OCR (det ændrer krydser og logger initialer).");
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
        mark: "scan",
        pid: getCurrentPidValue(),
        pidIdx: currentPidIdx,
        pidColor: (pidOptions.length > 1) ? (currentPidIdx % 4) : 0,
      };
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
      const msg = (err?.message ?? String(err));
      if(/Failed to fetch|NetworkError|CORS/i.test(msg)){
        alert(
          "Login fejlede (forbindelse/CORS).\n\n" +
          "Hvis du kører lokalt (localhost/Live Server), skal backend tillade din origin i CORS.\n" +
          "Alternativt: kør via GitHub Pages/den tilladte URL.\n\n" +
          "Teknisk fejl: " + msg
        );
      }else{
        alert("Login fejlede: " + msg);
      }
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


// ---------- Revision modal wiring ----------
const revModal = document.getElementById("revModal");
const btnRevClose = document.getElementById("btnRevClose");
const btnRevSave = document.getElementById("btnRevSave");
const btnRevCancel = document.getElementById("btnRevCancel");
const revDescEl = document.getElementById("revDesc");
const revTbodyEl = document.getElementById("revTbody");
const revLastSummaryEl = document.getElementById("revLastSummary");
const revLastChangesEl = document.getElementById("revLastChanges");

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

function renderRevisions(rec){
  if(!revTbodyEl) return;
  const revs = getRevisionsSorted(rec);

  if(!revs.length){
    revTbodyEl.innerHTML = `<tr><td colspan="4" class="muted">Ingen ændringer endnu.</td></tr>`;
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
    revLastChangesEl.textContent = last.changes ? last.changes : "—";
  }

  const rows = revs.slice(0, 80).map(r => {
    const ch = (r.changes || "").trim();
    const chHtml = escapeHtml(ch).replace(/\n/g, "<br>");
    return `<tr>` +
      `<td>${escapeHtml(formatRevDate(r.at))}</td>` +
      `<td>${escapeHtml(r.by || "—")}</td>` +
      `<td>${escapeHtml(r.desc || "")}</td>` +
      `<td>${chHtml || "—"}</td>` +
    `</tr>`;
  }).join("");
  revTbodyEl.innerHTML = rows;
}


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
  });
}

if(fields.main){
  fields.main.addEventListener("input", () => {
    updateAvailabilityDisplay();
  });
}

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


// ---------- Buttons ----------
el("btnNew").addEventListener("click", clearForm);

el("btnSave").addEventListener("click", async () => {
  const user = requireLogin("Du skal være logget ind for at kunne gemme (så vi kan logge initialer).");
  if(!user) return;

  const v = validateSingleMainNumber(fields.main.value);
  if(!v.ok){ alert(v.message); return; }

  // Cloud: avoid duplicates on the same hovedkomponentnr.
  if(USE_CLOUD){
    try{
      await fetchRecordsCache();
    }catch(err){
      alert("Kunne ikke hente cloud-poster til dublet-tjek. Prøv igen.\n\n" + (err?.message ?? err));
      return;
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
          if(confirm(msg)){
            setFormData(conflict);
            renderRecordList();
          }
          return;
        }

        // Editing an existing post with same hovednummer while duplicates already exist.
        // Allow save, but warn the user.
        const ok = confirm(
          `OBS: Der findes allerede en anden cloud-post med samme hovednummer (${conflict.hovedkomponentnr}).\n` +
          `Det kan give forvirring.\n\nVil du gemme denne post alligevel?`
        );
        if(!ok) return;
      }
    }
  }

  const desc = await requestRevisionDescription();
  if(desc === null) return;
  const revDesc = String(desc || "").trim();
  if(!revDesc){
    alert("Skriv en kort beskrivelse (fx projektnr.).");
    return;
  }

  const prevRec = activeId ? loadRecords().find(r => r.id === activeId) : null;

  const rec = getFormData();
  const changes = computeTagChanges(prevRec, rec);

  if(!Array.isArray(rec.revisions)) rec.revisions = [];
  rec.revisions.push({ at: rec.updatedAt, by: user.initials, desc: revDesc, changes });

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
      meta: { selectedCount: (rec.selectedCodes||[]).length, revision: revDesc, changes }
    });

    renderRevisions(rec);
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
  const mainRaw = (fields.main.value || "").trim();
  const vMain = validateSingleMainNumber(mainRaw);
  if(!vMain.ok){ alert(vMain.message); return; }
  const main = parseMainNumber(mainRaw);
  const desc = (fields.desc.value || "").trim();
  const plant = (fields.plant.value || "").trim();
  const pid = (fields.pid.value || "").trim();
  const signHeader = [ (fields.sign1.value||"").trim(), (fields.sign2.value||"").trim() ].filter(Boolean).join("; ");
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
    const mark = meta.mark || ((codeSource[code] === "scan") ? "scan" : "blue");
    const markLabel = (mark === "red") ? "🔴 Rød" : (mark === "scan" ? "🟩 Scan" : "🔵 Blå");
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
      "Markering": markLabel,        // Blå / Rød / Scan
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
    "Markering",
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
    { wch: 10 },
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
  setVal('#fSign2', rec?.signatur2 ?? '');

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
  const signHeader = [ String(rec?.signatur1 || "").trim(), String(rec?.signatur2 || "").trim() ].filter(Boolean).join("; ");

  const codes = Array.isArray(rec?.selectedCodes) ? rec.selectedCodes.map(String) : [];
  codes.sort((a,b)=>parseInt(a,10)-parseInt(b,10));

  const sources = (rec?.codeSources && typeof rec.codeSources === "object") ? rec.codeSources : {};
  const metaMap = (rec?.codeMeta && typeof rec.codeMeta === "object") ? rec.codeMeta : {};

  return codes.map(code => {
    const meta = metaMap?.[code] || {};
    const src = sources?.[code] || meta.source || "manual";
    const mark = meta.mark || (src === "scan" ? "scan" : "blue");
    const markLabel = (mark === "red") ? "🔴 Rød" : (mark === "scan" ? "🟩 Scan" : "🔵 Blå");
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
      "Markering": markLabel,
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
    "Markering",
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
    { wch: 12 },
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

if(btnExportExcelSelected){
  btnExportExcelSelected.addEventListener("click", exportExcelFromSelectedRecords);
}

if(btnPrintSelected){
  btnPrintSelected.addEventListener("click", printSelectedRecords);
}

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
  setMarkMode(currentMark);
  setFilterMode(currentFilter);
  setSeries(currentSeries);
  renderRevisions(null);
  refreshPidOptionsFromField();

  if(USE_CLOUD && getCurrentUser()){
    refreshRecords().catch(() => renderRecordList());
  }else{
    renderRecordList();
  }
})();
