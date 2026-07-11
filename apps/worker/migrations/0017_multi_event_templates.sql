ALTER TABLE operation_days ADD COLUMN aerodrome TEXT NOT NULL DEFAULT '';
ALTER TABLE operation_days ADD COLUMN archived_at TEXT;
ALTER TABLE operation_days ADD COLUMN template_source_id TEXT REFERENCES operation_days(id) ON DELETE SET NULL;

CREATE INDEX idx_operation_days_date_archive
  ON operation_days(archived_at, event_date DESC);
