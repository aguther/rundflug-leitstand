-- Wiederherstellung: Vor Anwendung einen D1-Time-Travel-Punkt beziehungsweise eine portable
-- Sicherung anlegen. Die ergänzten Spalten können nur durch Wiederherstellung oder einen
-- kontrollierten Tabellenneuaufbau entfernt werden.
ALTER TABLE products ADD COLUMN planned_boarding_minutes_override INTEGER
  CHECK (planned_boarding_minutes_override IS NULL
    OR planned_boarding_minutes_override BETWEEN 0 AND 120);
ALTER TABLE products ADD COLUMN planned_deboarding_minutes_override INTEGER
  CHECK (planned_deboarding_minutes_override IS NULL
    OR planned_deboarding_minutes_override BETWEEN 0 AND 120);
ALTER TABLE products ADD COLUMN planned_buffer_minutes_override INTEGER
  CHECK (planned_buffer_minutes_override IS NULL
    OR planned_buffer_minutes_override BETWEEN 0 AND 120);

CREATE TABLE aircraft_product_turnaround_overrides (
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE CASCADE,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  planned_boarding_minutes_override INTEGER
    CHECK (planned_boarding_minutes_override IS NULL
      OR planned_boarding_minutes_override BETWEEN 0 AND 120),
  planned_deboarding_minutes_override INTEGER
    CHECK (planned_deboarding_minutes_override IS NULL
      OR planned_deboarding_minutes_override BETWEEN 0 AND 120),
  planned_buffer_minutes_override INTEGER
    CHECK (planned_buffer_minutes_override IS NULL
      OR planned_buffer_minutes_override BETWEEN 0 AND 120),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (operation_day_id, aircraft_id, product_id),
  CHECK (
    planned_boarding_minutes_override IS NOT NULL
    OR planned_deboarding_minutes_override IS NOT NULL
    OR planned_buffer_minutes_override IS NOT NULL
  )
);

CREATE INDEX idx_aircraft_product_turnaround_overrides_product
  ON aircraft_product_turnaround_overrides(operation_day_id, product_id, aircraft_id);

CREATE TRIGGER aircraft_product_turnaround_override_product_event_insert
BEFORE INSERT ON aircraft_product_turnaround_overrides
WHEN NOT EXISTS (
  SELECT 1 FROM products p
   WHERE p.id = NEW.product_id AND p.operation_day_id = NEW.operation_day_id
)
BEGIN
  SELECT RAISE(ABORT, 'turnaround override product event mismatch');
END;

CREATE TRIGGER aircraft_product_turnaround_override_aircraft_event_insert
BEFORE INSERT ON aircraft_product_turnaround_overrides
WHEN NOT EXISTS (
  SELECT 1 FROM resource_group_memberships membership
   WHERE membership.aircraft_id = NEW.aircraft_id
     AND membership.operation_day_id = NEW.operation_day_id
)
BEGIN
  SELECT RAISE(ABORT, 'turnaround override aircraft event mismatch');
END;
