PRAGMA foreign_keys = OFF;

ALTER TABLE paired_devices RENAME TO paired_devices_v1;

CREATE TABLE paired_devices (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CASHIER', 'FLIGHT_LINE', 'FLIGHT_DIRECTOR', 'ADMIN', 'DISPLAY')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  paired_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  credential_hash TEXT,
  CHECK (revoked_at IS NULL OR active = 0)
) STRICT;

INSERT INTO paired_devices
  (id, operation_day_id, label, role, active, paired_at, last_seen_at, revoked_at, credential_hash)
SELECT id, operation_day_id, label, role, active, paired_at, last_seen_at, revoked_at, credential_hash
  FROM paired_devices_v1;

DROP TABLE paired_devices_v1;
CREATE INDEX idx_paired_devices_event_active ON paired_devices(operation_day_id, active, role);
CREATE INDEX idx_paired_devices_credential ON paired_devices(operation_day_id, id, active, credential_hash);

ALTER TABLE rotations ADD COLUMN call_revoked_at TEXT;

CREATE TABLE operational_blocks (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('EVENT', 'RESOURCE_GROUP', 'AIRCRAFT')),
  scope_id TEXT NOT NULL,
  block_type TEXT NOT NULL CHECK (block_type IN ('WEATHER_NOTICE', 'INTERRUPTION', 'PAUSE', 'REFUELING')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CLEARED')),
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expected_review_at TEXT,
  cleared_at TEXT,
  device_id TEXT NOT NULL
) STRICT;

CREATE INDEX idx_operational_blocks_active
  ON operational_blocks(operation_day_id, scope_type, scope_id, status);

PRAGMA foreign_keys = ON;
