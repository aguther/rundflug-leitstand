PRAGMA foreign_keys = ON;

ALTER TABLE gates ADD COLUMN display_filter_json TEXT NOT NULL
  DEFAULT '{"productIds":[],"rotationStatuses":[]}'
  CHECK (json_valid(display_filter_json));
