PRAGMA foreign_keys = ON;

CREATE TABLE operation_days (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  time_zone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  status TEXT NOT NULL DEFAULT 'PREPARATION',
  emergency_mode INTEGER NOT NULL DEFAULT 0 CHECK (emergency_mode IN (0, 1)),
  operational_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE resource_groups (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (operation_day_id, name)
) STRICT;

CREATE TABLE aircraft (
  id TEXT PRIMARY KEY,
  registration TEXT NOT NULL UNIQUE,
  aircraft_type TEXT NOT NULL,
  passenger_seats INTEGER NOT NULL CHECK (passenger_seats > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE resource_group_memberships (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  resource_group_id TEXT NOT NULL REFERENCES resource_groups(id) ON DELETE RESTRICT,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE RESTRICT,
  active_from TEXT NOT NULL,
  active_until TEXT,
  created_at TEXT NOT NULL,
  CHECK (active_until IS NULL OR active_until > active_from)
) STRICT;

CREATE UNIQUE INDEX uq_aircraft_one_active_resource_group
  ON resource_group_memberships(operation_day_id, aircraft_id)
  WHERE active_until IS NULL;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  resource_group_id TEXT NOT NULL REFERENCES resource_groups(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  sale_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sale_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (operation_day_id, name)
) STRICT;

CREATE TABLE ticket_groups (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  queue_sequence INTEGER NOT NULL CHECK (queue_sequence > 0),
  standby INTEGER NOT NULL DEFAULT 0 CHECK (standby IN (0, 1)),
  status TEXT NOT NULL,
  sold_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  UNIQUE (operation_day_id, product_id, queue_sequence)
) STRICT;

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  ticket_group_id TEXT NOT NULL REFERENCES ticket_groups(id) ON DELETE RESTRICT,
  public_code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  weight_class TEXT NOT NULL,
  individual_weight_kg REAL,
  payment_status TEXT NOT NULL DEFAULT 'INFORMATIONAL_ONLY',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE flight_groups (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  resource_group_id TEXT NOT NULL REFERENCES resource_groups(id) ON DELETE RESTRICT,
  communication_number INTEGER NOT NULL CHECK (communication_number > 0),
  status TEXT NOT NULL,
  predicted_boarding_at TEXT,
  predicted_departure_at TEXT,
  prediction_lower_minutes INTEGER,
  prediction_upper_minutes INTEGER,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (operation_day_id, resource_group_id, communication_number)
) STRICT;

CREATE TABLE rotations (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  flight_group_id TEXT NOT NULL REFERENCES flight_groups(id) ON DELETE RESTRICT,
  aircraft_id TEXT REFERENCES aircraft(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  called_at TEXT,
  departed_at TEXT,
  landed_at TEXT,
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE rotation_tickets (
  rotation_id TEXT NOT NULL REFERENCES rotations(id) ON DELETE RESTRICT,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (rotation_id, ticket_id)
) STRICT;

CREATE UNIQUE INDEX uq_ticket_one_active_rotation
  ON rotation_tickets(ticket_id)
  WHERE released_at IS NULL;

CREATE TABLE operational_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
) STRICT;

CREATE TRIGGER operational_events_no_update
BEFORE UPDATE ON operational_events
BEGIN
  SELECT RAISE(ABORT, 'operational_events is append-only');
END;

CREATE TRIGGER operational_events_no_delete
BEFORE DELETE ON operational_events
BEGIN
  SELECT RAISE(ABORT, 'operational_events is append-only');
END;

CREATE TABLE idempotency_receipts (
  command_id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json))
) STRICT;

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  published_at TEXT
) STRICT;

CREATE INDEX idx_events_day_sequence ON operational_events(operation_day_id, sequence);
CREATE INDEX idx_outbox_unpublished ON outbox(created_at) WHERE published_at IS NULL;
CREATE INDEX idx_ticket_groups_queue ON ticket_groups(operation_day_id, product_id, status, queue_sequence);
CREATE INDEX idx_flight_groups_queue ON flight_groups(operation_day_id, resource_group_id, status, communication_number);
