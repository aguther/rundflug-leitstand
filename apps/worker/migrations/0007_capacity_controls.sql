-- Kapazitätsparameter sind Konfiguration; bei Rollback bleiben Verkäufe erhalten und nur die
-- dynamische Ampel fällt auf den vorherigen Stand zurück.
ALTER TABLE operation_days ADD COLUMN operations_end_at TEXT;
ALTER TABLE products ADD COLUMN capacity_warning_threshold INTEGER NOT NULL DEFAULT 12
  CHECK (capacity_warning_threshold >= 0);
ALTER TABLE products ADD COLUMN capacity_critical_threshold INTEGER NOT NULL DEFAULT 4
  CHECK (capacity_critical_threshold >= 0);
