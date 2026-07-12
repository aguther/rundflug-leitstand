CREATE TABLE app_bootstrap (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  operation_day_id TEXT NOT NULL UNIQUE REFERENCES operation_days(id) ON DELETE RESTRICT,
  admin_device_id TEXT NOT NULL UNIQUE REFERENCES paired_devices(id) ON DELETE RESTRICT,
  completed_at TEXT NOT NULL
) STRICT;
