-- Piloten bleiben ausschließlich anonyme operative Codes gemäß ADR-0006.
ALTER TABLE pilots ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1));
ALTER TABLE pilots ADD COLUMN pause_expected_review_at TEXT;
CREATE INDEX idx_pilots_available
  ON pilots(operation_day_id, active, paused, operational_code);
