ALTER TABLE flight_groups
  ADD COLUMN precall_decision_status TEXT
  CHECK (
    precall_decision_status IS NULL
    OR precall_decision_status IN ('WAITING', 'PREPARE', 'GO_TO_GATE')
  );

ALTER TABLE flight_groups
  ADD COLUMN precall_decision_reason TEXT
  CHECK (
    precall_decision_reason IS NULL
    OR precall_decision_reason IN (
      'ELIGIBLE',
      'DISABLED',
      'OPERATIONS_BLOCKED',
      'NOT_QUEUE_FRONT',
      'ALREADY_PRECALLED',
      'NO_FORECAST_CAPACITY',
      'NO_FITTING_AIRCRAFT',
      'TOO_EARLY'
    )
  );

ALTER TABLE flight_groups ADD COLUMN precall_decision_at TEXT;
ALTER TABLE flight_groups ADD COLUMN precall_predicted_boarding_at TEXT;
ALTER TABLE flight_groups
  ADD COLUMN precall_adaptive_lead_minutes INTEGER
  CHECK (
    precall_adaptive_lead_minutes IS NULL
    OR precall_adaptive_lead_minutes >= 0
  );

CREATE INDEX idx_flight_groups_precall_decision
  ON flight_groups(operation_day_id, resource_group_id, precall_decision_status);
