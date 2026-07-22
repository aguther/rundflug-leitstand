-- Release 1.7.3: dedizierte DISPLAY-Konten und kontobezogene FIDS-Einstellungen.
-- Vor Anwendung ist eine D1-Time-Travel-Marke beziehungsweise eine vollständige D1-Sicherung
-- anzulegen. Für die Wiederherstellung wird der ältere Worker wieder bereitgestellt und die
-- Datenbank per D1 Time Travel auf den Stand unmittelbar vor dieser Migration zurückgesetzt.
-- Portable fachliche Backups schließen Konten, Sitzungen und diese Einstellungen weiterhin
-- bewusst aus.
PRAGMA foreign_keys = OFF;

CREATE TABLE operator_accounts_v173 (
  id TEXT PRIMARY KEY,
  login_code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN (
    'CASHIER', 'FLIGHT_LINE', 'FLIGHT_DIRECTOR', 'ADMIN', 'DISPLAY'
  )),
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO operator_accounts_v173
  (id, login_code, role, pin_hash, active, failed_attempts, locked_until,
   session_version, created_at, updated_at)
SELECT id, login_code, role, pin_hash, active, failed_attempts, locked_until,
       session_version, created_at, updated_at
  FROM operator_accounts;

DROP TABLE operator_accounts;
ALTER TABLE operator_accounts_v173 RENAME TO operator_accounts;

CREATE INDEX idx_operator_accounts_active_role
  ON operator_accounts(active, role, login_code);

CREATE TABLE fids_preferences (
  operator_account_id TEXT NOT NULL,
  operation_day_id TEXT NOT NULL,
  visible_rows INTEGER NOT NULL DEFAULT 8 CHECK (visible_rows BETWEEN 4 AND 20),
  layout TEXT NOT NULL DEFAULT 'SINGLE' CHECK (layout IN ('SINGLE', 'DOUBLE')),
  theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('SYSTEM', 'LIGHT', 'DARK')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (operator_account_id, operation_day_id),
  FOREIGN KEY (operator_account_id) REFERENCES operator_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (operation_day_id) REFERENCES operation_days(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_fids_preferences_operation_day
  ON fids_preferences(operation_day_id, operator_account_id);

PRAGMA foreign_keys = ON;
