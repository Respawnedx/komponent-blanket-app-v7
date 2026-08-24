-- Tracks failed login attempts for application-level brute-force protection.

CREATE TABLE IF NOT EXISTS login_throttle (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT,
  last_failed_at TEXT,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_throttle_scope ON login_throttle(scope);
CREATE INDEX IF NOT EXISTS idx_login_throttle_locked ON login_throttle(locked_until);
