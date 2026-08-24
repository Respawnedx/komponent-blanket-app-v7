// Revision diffing and display helpers.
// Loaded before app.js and exposed through window.KomponentDB.revisions.
(function(){
  const root = window.KomponentDB = window.KomponentDB || {};

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }

  function createRevisionHelpers(deps){
    const {
      TAG_STATUS,
      parsePidList,
      buildTag,
      normalizeTagStatus,
      markSymbol,
      transitionLabel,
      addedChangeLabel,
      removedChangeLabel,
    } = deps;

    function getRecMark(rec, code){
      if(!rec) return TAG_STATUS.ACTIVE;
      const meta = rec.codeMeta || {};
      return normalizeTagStatus(meta?.[code]?.mark || TAG_STATUS.ACTIVE);
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

      for(const code of currRec.selectedCodes || []){
        if(!prevSel.has(code)){
          const tag = buildTag(main, code);
          const mark = getRecMark(currRec, code);
          pushGrouped(addedByLabel, addedChangeLabel(mark), formatChangeItem(tag, mark, getRecPid(currRec, code), showPid));
        }else{
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

    return {
      getRecMark,
      getRecPid,
      computeTagChanges,
      formatRevDate,
      getRevisionsSorted,
      lastRevisionString,
      revisionChipsHtml,
    };
  }

  root.revisions = {
    createRevisionHelpers,
  };
})();
