-- Flottensteuerung bleibt organisatorisch und enthält keine sicherheitsbezogene Freigabe.
-- Rollback: neue Spalten können ignoriert werden; Piloten-Codes werden aus dem portablen Backup
-- wiederhergestellt. Bestehende Umläufe und Audit-Ereignisse bleiben unverändert.
ALTER TABLE aircraft ADD COLUMN rotations_since_refuel INTEGER NOT NULL DEFAULT 0
  CHECK (rotations_since_refuel >= 0);
ALTER TABLE aircraft ADD COLUMN refuel_reminder_threshold INTEGER NOT NULL DEFAULT 5
  CHECK (refuel_reminder_threshold > 0);
ALTER TABLE aircraft ADD COLUMN refuel_planned INTEGER NOT NULL DEFAULT 0
  CHECK (refuel_planned IN (0, 1));

CREATE TABLE pilots (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  operational_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (operation_day_id, operational_code)
) STRICT;

ALTER TABLE rotations ADD COLUMN pilot_id TEXT REFERENCES pilots(id) ON DELETE RESTRICT;
CREATE INDEX idx_pilots_event_active ON pilots(operation_day_id, active, operational_code);
