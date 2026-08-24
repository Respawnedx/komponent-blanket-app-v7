// Print, Excel export, and JSON backup helpers.
// Loaded before app.js and exposed through window.KomponentDB.exportTools.
(function(){
  const root = window.KomponentDB = window.KomponentDB || {};

  function createExportTools(deps){
    const {
      TAG_STATUS,
      parseRange,
      pad2,
      parsePidList,
      parseMainNumber,
      normalizeDateInputValue,
      formatDateValue,
      formatOpsaetning,
      buildTag,
      normalizeTagStatus,
      tagStatusLabel,
      tagStatusSymbol,
      isScanSourceValue,
      lastRevisionString,
      loadRecords,
      refreshRecords,
      getFormData,
      getActiveId,
      getSelectedRecordIds,
      isCloudMode,
      getCurrentUser,
      stripClientOnlyRecordFields,
      getXLSX,
    } = deps;

    const shouldUseCloud = () => !!(typeof isCloudMode === "function" ? isCloudMode() : isCloudMode);
    const readSelectedIds = () => Array.from(getSelectedRecordIds?.() || []);
    const readSelectedSet = () => getSelectedRecordIds?.() || new Set();

    async function refreshIfCloud(){
      if(shouldUseCloud() && typeof refreshRecords === "function"){
        try{ await refreshRecords(); }catch{}
      }
    }

    function recordsForSelectedIds(ids){
      const all = loadRecords();
      const byId = new Map(all.map(r => [r.id, r]));
      let recs = ids.map(id => byId.get(id)).filter(Boolean);

      const activeId = getActiveId?.();
      const selectedSet = readSelectedSet();
      if(activeId && selectedSet.has(activeId) && typeof getFormData === "function"){
        try{
          const current = getFormData();
          recs = recs.map(r => (r.id === activeId ? current : r));
        }catch{}
      }

      return recs;
    }

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

      const setVal = (sel, val) => {
        const elx = p.querySelector(sel);
        if(!elx) return;
        const v = String(val ?? "");
        elx.value = v;
        elx.setAttribute("value", v);
      };
      setVal("#fMain", rec?.hovedkomponentnr ?? "");
      setVal("#fDesc", rec?.beskrivelse ?? "");
      setVal("#fPlant", rec?.anlaeg ?? "");
      setVal("#fPid", rec?.pid ?? "");
      setVal("#fSign1", rec?.signatur1 ?? "");
      setVal("#fSign2", normalizeDateInputValue(rec?.signatur2 ?? "") || "");

      if(series !== 0){
        p.classList.add("paper--series-nz");
      }

      const selectedSet = new Set((rec?.selectedCodes || []).map(String));
      const sections = Array.from(p.querySelectorAll(".section"));
      for(const sec of sections){
        const grid = sec.querySelector(".grid");
        if(!grid) continue;

        const span = sec.querySelector(".secRange");
        if(span){
          span.textContent = formatRangeLabelForSeries(grid.dataset.range, series);
        }

        buildGridForPrint(grid, series, rec, selectedSet);
      }

      const badge = document.createElement("div");
      badge.className = "printSeriesBadge muted";
      badge.textContent = series === 0 ? "Serie: 0xx" : `Serie: ${series}xx`;
      p.appendChild(badge);

      return p;
    }

    async function printSelectedRecords(){
      await refreshIfCloud();

      const ids = readSelectedIds();
      if(ids.length === 0){
        alert("Markér en eller flere poster i venstre liste (checkbox).\nTip: Du kan bruge 'Markér alle'.");
        return;
      }

      let copies = 1;
      try{
        const ans = prompt("Antal kopier pr. hovednr.? (1 = standard)", "1");
        if(ans !== null && String(ans).trim() !== ""){
          const n = parseInt(ans, 10);
          if(Number.isFinite(n) && n >= 1 && n <= 10) copies = n;
        }
      }catch{}

      const pages = [];

      for(const rec of recordsForSelectedIds(ids)){
        const codes = Array.isArray(rec?.selectedCodes) ? rec.selectedCodes.map(String) : [];
        const seriesSet = new Set();
        for(const c of codes){
          const n = parseInt(c,10);
          if(!Number.isFinite(n)) continue;
          seriesSet.add(n >= 100 ? Math.floor(n/100) : 0);
        }

        let seriesList = Array.from(seriesSet).sort((a,b)=>a-b);
        if(seriesList.length === 0){
          seriesList = [0];
        }

        for(let k=0;k<copies;k++){
          for(const series of seriesList){
            const p = buildPaperForPrint(rec, series);
            if(!p) continue;
            const wrap = document.createElement("div");
            wrap.className = "printPage";
            wrap.appendChild(p);
            pages.push(wrap);
          }
        }
      }

      if(pages.length === 0){
        alert("Ingen sider at printe.");
        return;
      }

      let cssText = "";
      try{
        const r = await fetch("./styles.css", { cache: "no-store" });
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

      const w = window.open("", "_blank");
      if(!w){
        alert("Popup blev blokeret. Tillad popups for at kunne printe.");
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();

      const mount = () => {
        try{
          const body = w.document.body;
          for(const page of pages){
            body.appendChild(w.document.importNode(page, true));
          }
          w.focus();
          setTimeout(() => { try{ w.print(); }catch{} }, 250);
        }catch(err){
          alert("Kunne ikke bygge print-visning: " + (err?.message ?? err));
        }
      };

      if(w.document.readyState === "complete") mount();
      else w.onload = mount;
    }

    function forceExcelTextColumns(XLSX, ws, headers, rowCount){
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
      name = name.replace(/[\\/?*\[\]:]/g, "_");
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
      const XLSX = getXLSX?.() || window.XLSX;
      if(!XLSX){
        alert("Excel-biblioteket (XLSX) er ikke indlæst. Tjek internetforbindelse eller CDN-link i index.html.");
        return;
      }

      await refreshIfCloud();

      const ids = readSelectedIds();
      if(ids.length === 0){
        alert("Markér en eller flere poster i venstre liste (checkbox) eller tryk 'Markér alle'.");
        return;
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

      for(const rec of recordsForSelectedIds(ids)){
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
      const wsAll = XLSX.utils.json_to_sheet(allRows, { header: headers });
      forceExcelTextColumns(XLSX, wsAll, headers, allRows.length);
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

      for(const s of sheets){
        const ws = XLSX.utils.json_to_sheet(s.rows, { header: headers });
        forceExcelTextColumns(XLSX, ws, headers, s.rows.length);
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
        source: shouldUseCloud() ? "cloud" : "local",
        exportedBy: user?.initials || null,
        count: cleanRecords.length,
        records: cleanRecords,
      };
    }

    return {
      printSelectedRecords,
      exportExcelFromSelectedRecords,
      localDateStampForFilename,
      buildJsonBackupPayload,
    };
  }

  root.exportTools = {
    createExportTools,
  };
})();
