PRAGMA foreign_keys = ON;

CREATE TABLE flight_line_assist_claims (
  operation_day_id TEXT NOT NULL,
  aircraft_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (operation_day_id, aircraft_id),
  FOREIGN KEY (operation_day_id) REFERENCES operation_days(id) ON DELETE CASCADE,
  FOREIGN KEY (aircraft_id) REFERENCES aircraft(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES paired_devices(id) ON DELETE CASCADE
);

CREATE INDEX flight_line_assist_claims_by_device
  ON flight_line_assist_claims(operation_day_id, device_id, expires_at);
