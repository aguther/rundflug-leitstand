-- Additive fairness state. Create a D1 Time Travel bookmark or portable backup before applying.
-- A complete rollback restores the database to that bookmark or backup.
ALTER TABLE rotations ADD COLUMN dispatch_confirmed_overtake_count INTEGER NOT NULL DEFAULT 0
  CHECK (dispatch_confirmed_overtake_count >= 0);

ALTER TABLE forecast_snapshots ADD COLUMN dispatch_confirmed_overtake_count INTEGER NOT NULL DEFAULT 0
  CHECK (dispatch_confirmed_overtake_count >= 0);
