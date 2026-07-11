CREATE TABLE gates (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  gate_type TEXT NOT NULL DEFAULT 'FLIGHT_LINE' CHECK (gate_type IN ('FLIGHT_LINE', 'BOARDING', 'DISPLAY_ONLY')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (operation_day_id, label)
) STRICT;

INSERT INTO gates (id, operation_day_id, label, gate_type, active, sort_order, created_at, updated_at)
SELECT id || '-gate-main', id, 'Flight Line 1', 'FLIGHT_LINE', 1, 10, created_at, updated_at
  FROM operation_days;

ALTER TABLE resource_groups ADD COLUMN gate_id TEXT REFERENCES gates(id) ON DELETE RESTRICT;
ALTER TABLE products ADD COLUMN code TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN public_description TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN child_companion_required INTEGER NOT NULL DEFAULT 0
  CHECK (child_companion_required IN (0, 1));
ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN weight_classes_json TEXT NOT NULL DEFAULT '["NOT_CAPTURED"]'
  CHECK (json_valid(weight_classes_json));
ALTER TABLE products ADD COLUMN gate_id TEXT REFERENCES gates(id) ON DELETE RESTRICT;

UPDATE resource_groups
   SET gate_id = operation_day_id || '-gate-main'
 WHERE gate_id IS NULL;
UPDATE products
   SET code = UPPER(SUBSTR(REPLACE(id, '-', ''), 1, 12)),
       gate_id = operation_day_id || '-gate-main'
 WHERE code = '';

CREATE UNIQUE INDEX uq_products_event_code ON products(operation_day_id, code);
CREATE INDEX idx_gates_event_active ON gates(operation_day_id, active, sort_order);
