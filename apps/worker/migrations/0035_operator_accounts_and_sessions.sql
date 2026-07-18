-- Produktrelease V1.2: pseudonyme Helferkonten und widerrufbare Browser-Sitzungen.
-- Vor Anwendung ist eine portable D1-Sicherung erforderlich. Ein Rollback erfolgt per D1 Time
-- Travel beziehungsweise aus dieser Sicherung; ältere Worker kennen die neuen Tabellen nicht,
-- bestehende fachliche Daten und Gerätebindungen bleiben unverändert.
CREATE TABLE operator_accounts (
  id TEXT PRIMARY KEY,
  login_code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN (
    'CASHIER', 'FLIGHT_LINE', 'FLIGHT_DIRECTOR', 'ADMIN'
  )),
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE operator_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES operator_accounts(id) ON DELETE CASCADE,
  session_version INTEGER NOT NULL CHECK (session_version > 0),
  token_hash TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (idle_expires_at > created_at),
  CHECK (absolute_expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
) STRICT;

CREATE INDEX idx_operator_accounts_active_role
  ON operator_accounts(active, role, login_code);

CREATE INDEX idx_operator_sessions_account_active
  ON operator_sessions(account_id, revoked_at, absolute_expires_at);

CREATE INDEX idx_operator_sessions_token_active
  ON operator_sessions(token_hash, revoked_at, idle_expires_at, absolute_expires_at);
