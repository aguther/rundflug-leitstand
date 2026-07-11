ALTER TABLE operation_days ADD COLUMN sale_opens_at TEXT;
ALTER TABLE operation_days ADD COLUMN no_show_after_minutes INTEGER NOT NULL DEFAULT 10
  CHECK (no_show_after_minutes BETWEEN 1 AND 120);
ALTER TABLE operation_days ADD COLUMN notification_lead_minutes INTEGER NOT NULL DEFAULT 15
  CHECK (notification_lead_minutes BETWEEN 1 AND 240);
ALTER TABLE operation_days ADD COLUMN child_reference_weight_kg REAL NOT NULL DEFAULT 35
  CHECK (child_reference_weight_kg > 0);
ALTER TABLE operation_days ADD COLUMN normal_reference_weight_kg REAL NOT NULL DEFAULT 80
  CHECK (normal_reference_weight_kg > 0);
ALTER TABLE operation_days ADD COLUMN heavy_reference_weight_kg REAL NOT NULL DEFAULT 110
  CHECK (heavy_reference_weight_kg > 0);
ALTER TABLE operation_days ADD COLUMN planned_boarding_minutes INTEGER NOT NULL DEFAULT 8
  CHECK (planned_boarding_minutes BETWEEN 1 AND 120);
ALTER TABLE operation_days ADD COLUMN planned_deboarding_minutes INTEGER NOT NULL DEFAULT 5
  CHECK (planned_deboarding_minutes BETWEEN 1 AND 120);
ALTER TABLE operation_days ADD COLUMN planned_buffer_minutes INTEGER NOT NULL DEFAULT 3
  CHECK (planned_buffer_minutes BETWEEN 0 AND 120);
