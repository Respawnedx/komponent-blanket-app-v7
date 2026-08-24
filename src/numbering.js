// Shared number/date helpers for the Komponentdatabase frontend.
// Loaded before app.js and exposed through window.KomponentDB.numbering.
(function(){
  const root = window.KomponentDB = window.KomponentDB || {};

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

  function parsePidList(raw){
    const s = String(raw || "");
    const nums = s.match(/\b\d{3,6}\b/g) || [];
    const uniq = [];
    for(const n of nums){
      const t = String(n).trim();
      if(t && !uniq.includes(t)) uniq.push(t);
    }
    return uniq;
  }

  function parseMainNumber(raw){
    const s = String(raw || "").trim();
    if(!s) return "";
    const m1 = s.match(/^\s*(\d{1,10})/);
    if(m1) return m1[1];
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

    const groups = [...s.matchAll(/\b\d{4,10}\b/g)].map(m => m[0]);
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

  function buildTagKeepZeros(mainRaw, code){
    const main = parseMainNumber(mainRaw);
    const ops = formatOpsaetning(code);
    return main ? `${main}.${ops}` : "";
  }

  function parseTagString(tagStr){
    const t = String(tagStr || "").trim();
    if(!t) return null;
    const m = t.match(/^\s*(\d{1,10})\s*\.\s*(\d{1,10})\s*$/);
    if(!m) return null;

    const mainRaw = m[1];
    const codeRaw = m[2];
    const codeNum = parseInt(codeRaw, 10);
    if(!Number.isFinite(codeNum)) return null;

    if(codeNum >= 1 && codeNum <= 99){
      return { mainRaw, codeKey: pad2(codeNum) };
    }

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

  function codeKeyForExplicitSeries(series, suffix){
    const s = Math.max(0, Math.min(9, parseInt(series, 10) || 0));
    const n = Math.max(1, Math.min(99, parseInt(suffix, 10) || 0));
    return s === 0 ? pad2(n) : String(s * 100 + n);
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

  root.numbering = {
    parseRange,
    pad2,
    parseSuffixInput,
    compressRanges,
    parsePidList,
    parseMainNumber,
    stripLeadingZeros,
    validateSingleMainNumber,
    formatOpsaetning,
    buildTag,
    buildTagKeepZeros,
    parseTagString,
    normalizeMainKey,
    codeKeyForExplicitSeries,
    todayDateInputValue,
    normalizeDateInputValue,
    formatDateValue,
    setDateFieldValue,
    getDateFieldValue,
  };
})();
