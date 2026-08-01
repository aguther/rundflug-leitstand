-- Wiederherstellung: Vor Anwendung einen D1-Time-Travel-Punkt beziehungsweise eine portable
-- Sicherung anlegen. Die additiven Felder werden bei einer vollständigen Wiederherstellung auf
-- den Stand vor 0060 entfernt; bestehende Datensätze bleiben durch neutrale Defaults kompatibel.
ALTER TABLE gates ADD COLUMN travel_lead_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (travel_lead_minutes BETWEEN 0 AND 30);

ALTER TABLE rotations ADD COLUMN dispatch_plan_id TEXT;
ALTER TABLE rotations ADD COLUMN dispatch_plan_revision TEXT;
ALTER TABLE rotations ADD COLUMN dispatch_batch_id TEXT;
ALTER TABLE rotations ADD COLUMN dispatch_order INTEGER
  CHECK (dispatch_order IS NULL OR dispatch_order > 0);
ALTER TABLE rotations ADD COLUMN dispatch_wave INTEGER
  CHECK (dispatch_wave IS NULL OR dispatch_wave > 0);
ALTER TABLE rotations ADD COLUMN dispatch_lane_id TEXT;
ALTER TABLE rotations ADD COLUMN dispatch_group_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(dispatch_group_ids_json));
ALTER TABLE rotations ADD COLUMN dispatch_occupied_seats INTEGER
  CHECK (dispatch_occupied_seats IS NULL OR dispatch_occupied_seats > 0);
ALTER TABLE rotations ADD COLUMN dispatch_available_seats INTEGER
  CHECK (dispatch_available_seats IS NULL OR dispatch_available_seats >= 0);
ALTER TABLE rotations ADD COLUMN dispatch_commitment_level TEXT
  CHECK (
    dispatch_commitment_level IS NULL
    OR dispatch_commitment_level IN ('WAITING', 'PREPARE', 'COME_TO_FLIGHT_LINE')
  );
ALTER TABLE rotations ADD COLUMN dispatch_decision_reasons_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(dispatch_decision_reasons_json));
ALTER TABLE rotations ADD COLUMN dispatch_projected_overtake_count INTEGER NOT NULL DEFAULT 0
  CHECK (dispatch_projected_overtake_count >= 0);
ALTER TABLE rotations ADD COLUMN dispatch_unplanned_reason TEXT
  CHECK (
    dispatch_unplanned_reason IS NULL
    OR dispatch_unplanned_reason IN (
      'NO_FORECAST_CAPACITY',
      'WAITING_FOR_FITTING_LANE',
      'WAITING_FOR_PRODUCT_FAIRNESS',
      'NOT_IN_NEAR_DISPATCH_BATCH',
      'COMMITMENT_LOCKED'
    )
  );

CREATE INDEX idx_rotations_dispatch_plan
  ON rotations(operation_day_id, dispatch_plan_revision, dispatch_order);

ALTER TABLE forecast_snapshots ADD COLUMN dispatch_plan_id TEXT;
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_plan_revision TEXT;
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_batch_id TEXT;
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_order INTEGER
  CHECK (dispatch_order IS NULL OR dispatch_order > 0);
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_wave INTEGER
  CHECK (dispatch_wave IS NULL OR dispatch_wave > 0);
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_lane_id TEXT;
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_group_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(dispatch_group_ids_json));
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_occupied_seats INTEGER
  CHECK (dispatch_occupied_seats IS NULL OR dispatch_occupied_seats > 0);
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_available_seats INTEGER
  CHECK (dispatch_available_seats IS NULL OR dispatch_available_seats >= 0);
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_commitment_level TEXT
  CHECK (
    dispatch_commitment_level IS NULL
    OR dispatch_commitment_level IN ('WAITING', 'PREPARE', 'COME_TO_FLIGHT_LINE')
  );
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_decision_reasons_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(dispatch_decision_reasons_json));
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_projected_overtake_count INTEGER NOT NULL DEFAULT 0
  CHECK (dispatch_projected_overtake_count >= 0);
ALTER TABLE forecast_snapshots ADD COLUMN dispatch_unplanned_reason TEXT
  CHECK (
    dispatch_unplanned_reason IS NULL
    OR dispatch_unplanned_reason IN (
      'NO_FORECAST_CAPACITY',
      'WAITING_FOR_FITTING_LANE',
      'WAITING_FOR_PRODUCT_FAIRNESS',
      'NOT_IN_NEAR_DISPATCH_BATCH',
      'COMMITMENT_LOCKED'
    )
  );

ALTER TABLE flight_groups ADD COLUMN precall_gate_id TEXT REFERENCES gates(id) ON DELETE SET NULL;
ALTER TABLE flight_groups ADD COLUMN precall_dispatch_reason TEXT
  CHECK (
    precall_dispatch_reason IS NULL
    OR precall_dispatch_reason IN (
      'NOT_IN_NEAR_DISPATCH_BATCH',
      'GATE_CAPACITY_COVERED',
      'WAITING_FOR_PRODUCT_FAIRNESS',
      'WAITING_FOR_FITTING_LANE',
      'COMMITMENT_LOCKED',
      'DISPATCH_PLAN_STALE'
    )
  );
ALTER TABLE flight_groups ADD COLUMN precall_adaptive_base_lead_minutes INTEGER
  CHECK (
    precall_adaptive_base_lead_minutes IS NULL
    OR precall_adaptive_base_lead_minutes >= 0
  );
ALTER TABLE flight_groups ADD COLUMN precall_gate_travel_lead_minutes INTEGER
  CHECK (
    precall_gate_travel_lead_minutes IS NULL
    OR precall_gate_travel_lead_minutes BETWEEN 0 AND 30
  );
ALTER TABLE flight_groups ADD COLUMN precall_effective_lead_minutes INTEGER
  CHECK (precall_effective_lead_minutes IS NULL OR precall_effective_lead_minutes >= 0);
ALTER TABLE flight_groups ADD COLUMN precall_boarding_window_lower_at TEXT;
ALTER TABLE flight_groups ADD COLUMN precall_boarding_window_upper_at TEXT;
