PRAGMA foreign_keys = ON;

CREATE TABLE paired_devices (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CASHIER', 'FLIGHT_LINE', 'FLIGHT_DIRECTOR', 'ADMIN', 'DISPLAY')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  paired_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (revoked_at IS NULL OR active = 0)
) STRICT;

CREATE INDEX idx_paired_devices_event_active
  ON paired_devices(operation_day_id, active, role);
