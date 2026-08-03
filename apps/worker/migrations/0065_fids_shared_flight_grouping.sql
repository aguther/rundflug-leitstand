-- Optional per-account FIDS grouping for booking groups sharing the same operational flight.
-- Create a D1 Time Travel marker or complete D1 backup before applying this migration.
-- Older workers ignore the additive column. A complete schema rollback uses D1 Time Travel
-- or restores the backup taken immediately before this migration.

ALTER TABLE fids_preferences
  ADD COLUMN group_shared_flights INTEGER NOT NULL DEFAULT 0
  CHECK (group_shared_flights IN (0, 1));
