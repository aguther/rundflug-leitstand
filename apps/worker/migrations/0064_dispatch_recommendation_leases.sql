-- Create a D1 Time Travel bookmark or portable backup before applying this additive migration.
-- Older Workers ignore this coordination table. A complete rollback requires restoring the
-- bookmark or backup taken before migration 0064.

CREATE TABLE dispatch_recommendation_leases (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE CASCADE,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  operator_account_id TEXT NOT NULL REFERENCES operator_accounts(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  acquire_command_id TEXT NOT NULL UNIQUE,
  dispatch_plan_revision TEXT NOT NULL,
  dispatch_batch_id TEXT NOT NULL,
  dispatch_order INTEGER NOT NULL CHECK (dispatch_order > 0),
  ticket_group_ids_json TEXT NOT NULL CHECK (json_valid(ticket_group_ids_json)),
  occupied_seats INTEGER NOT NULL CHECK (occupied_seats > 0),
  available_seats INTEGER NOT NULL CHECK (available_seats >= 0),
  decision_reasons_json TEXT NOT NULL CHECK (json_valid(decision_reasons_json)),
  status TEXT NOT NULL CHECK (status IN (
    'ACTIVE', 'RELEASED', 'EXPIRED', 'CONSUMED', 'INVALIDATED'
  )),
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  expired_at TEXT,
  consumed_at TEXT,
  invalidated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
) STRICT;

CREATE UNIQUE INDEX dispatch_recommendation_leases_active_batch
  ON dispatch_recommendation_leases(operation_day_id, dispatch_batch_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX dispatch_recommendation_leases_active_aircraft
  ON dispatch_recommendation_leases(operation_day_id, aircraft_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX dispatch_recommendation_leases_active_device
  ON dispatch_recommendation_leases(operation_day_id, operator_account_id, device_id)
  WHERE status = 'ACTIVE';

CREATE INDEX dispatch_recommendation_leases_active_expiry
  ON dispatch_recommendation_leases(operation_day_id, status, expires_at);

CREATE INDEX dispatch_recommendation_leases_owner
  ON dispatch_recommendation_leases(operation_day_id, operator_account_id, device_id, status);
