// Shared status helpers for component setup numbers.
// Loaded before app.js and exposed through window.KomponentDB.status.
(function(){
  const root = window.KomponentDB = window.KomponentDB || {};

  const TAG_STATUS = {
    ACTIVE: "blue",
    RESERVED: "reserved",
    RELEASED: "red",
  };

  function normalizeTagStatus(mark){
    const raw = String(mark || TAG_STATUS.ACTIVE).trim().toLowerCase();
    if(raw === TAG_STATUS.RESERVED || raw === "project" || raw === "temporary") return TAG_STATUS.RESERVED;
    if(raw === TAG_STATUS.RELEASED || raw === "free" || raw === "removed") return TAG_STATUS.RELEASED;
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

  root.status = {
    TAG_STATUS,
    normalizeTagStatus,
    tagStatusLabel,
    tagStatusSymbol,
    isBlockingStatus,
    isScanSourceValue,
    markSymbol,
    transitionLabel,
    addedChangeLabel,
    removedChangeLabel,
  };
})();
