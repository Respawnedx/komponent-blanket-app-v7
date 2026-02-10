-- D1 schema for Komponent-blanket backend

CREATE TABLE IF NOT EXISTS users (
  initials TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user',
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  hovedkomponentnr TEXT,
  beskrivelse TEXT,
  anlaeg TEXT,
  pid TEXT,
  signatur1 TEXT,
  signatur2 TEXT,
  selected_count INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_records_hoved ON records(hovedkomponentnr);
CREATE INDEX IF NOT EXISTS idx_records_updated ON records(updated_at);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  initials TEXT NOT NULL,
  action TEXT NOT NULL,
  record_id TEXT,
  hovednr TEXT,
  opsaetning INTEGER,
  tag TEXT,
  field TEXT,
  value TEXT,
  meta TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_record ON audit(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
