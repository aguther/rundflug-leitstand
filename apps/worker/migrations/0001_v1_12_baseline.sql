-- Rundflug-Leitstand V1.12 schema baseline.
-- This baseline intentionally replaces migrations 0001 through 0068.
-- Recovery: recreate the non-production D1 database and apply this file to an empty database.
-- Existing application data is not migrated or restored by this baseline.

CREATE TABLE aircraft (
  id TEXT PRIMARY KEY,
  registration TEXT NOT NULL UNIQUE,
  aircraft_type TEXT NOT NULL,
  passenger_seats INTEGER NOT NULL CHECK (passenger_seats > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, operational_state TEXT NOT NULL DEFAULT 'AVAILABLE'
  CHECK (operational_state IN ('AVAILABLE', 'BOARDING', 'IN_FLIGHT', 'LANDED', 'TURNAROUND', 'REFUELING', 'PAUSED', 'INACTIVE')), rotations_since_refuel INTEGER NOT NULL DEFAULT 0
  CHECK (rotations_since_refuel >= 0), refuel_reminder_threshold INTEGER NOT NULL DEFAULT 5
  CHECK (refuel_reminder_threshold > 0), refuel_planned INTEGER NOT NULL DEFAULT 0
  CHECK (refuel_planned IN (0, 1)), operational_interrupted INTEGER NOT NULL DEFAULT 0
  CHECK (operational_interrupted IN (0, 1)), maximum_passenger_payload_kg REAL
  CHECK (maximum_passenger_payload_kg IS NULL OR maximum_passenger_payload_kg > 0), operational_state_changed_at TEXT, version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)) STRICT;

CREATE TABLE aircraft_product_turnaround_overrides (
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE CASCADE,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  planned_boarding_minutes_override INTEGER
    CHECK (planned_boarding_minutes_override IS NULL
      OR planned_boarding_minutes_override BETWEEN 0 AND 120),
  planned_deboarding_minutes_override INTEGER
    CHECK (planned_deboarding_minutes_override IS NULL
      OR planned_deboarding_minutes_override BETWEEN 0 AND 120),
  planned_buffer_minutes_override INTEGER
    CHECK (planned_buffer_minutes_override IS NULL
      OR planned_buffer_minutes_override BETWEEN 0 AND 120),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (operation_day_id, aircraft_id, product_id),
  CHECK (
    planned_boarding_minutes_override IS NOT NULL
    OR planned_deboarding_minutes_override IS NOT NULL
    OR planned_buffer_minutes_override IS NOT NULL
  )
);

CREATE TABLE analysis_archive_events (
  id TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL REFERENCES analysis_archives(id) ON DELETE RESTRICT,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ARCHIVE_REQUESTED', 'ARCHIVE_BUILD_STARTED', 'ARCHIVE_READY',
    'ARCHIVE_FAILED', 'ARCHIVE_DOWNLOADED', 'ARCHIVE_EXPIRED', 'ARCHIVE_DELETED'
  )),
  occurred_at TEXT NOT NULL,
  actor_alias TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json))
) STRICT;

CREATE TABLE analysis_archives (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  operation_day_version INTEGER NOT NULL CHECK (operation_day_version >= 0),
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  privacy_profile TEXT NOT NULL CHECK (privacy_profile = 'SUPPORT_SAFE'),
  format_version INTEGER NOT NULL CHECK (format_version = 1),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'BUILDING', 'READY', 'FAILED', 'EXPIRED', 'DELETED'
  )),
  object_key TEXT,
  object_etag TEXT,
  object_size_bytes INTEGER CHECK (object_size_bytes IS NULL OR object_size_bytes >= 0),
  content_type TEXT,
  source_revision TEXT NOT NULL,
  application_version TEXT NOT NULL,
  requirements_version TEXT NOT NULL,
  entry_counts_json TEXT NOT NULL CHECK (json_valid(entry_counts_json)),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  failure_code TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE(operation_day_id, operation_day_version, format_version, privacy_profile)
) STRICT;

CREATE TABLE app_bootstrap (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  operation_day_id TEXT NOT NULL UNIQUE REFERENCES operation_days(id) ON DELETE RESTRICT,
  admin_device_id TEXT NOT NULL UNIQUE REFERENCES paired_devices(id) ON DELETE RESTRICT,
  completed_at TEXT NOT NULL
) STRICT;

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
, operation_day_version INTEGER NOT NULL DEFAULT 0 CHECK (operation_day_version >= 0), member_rotation_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(member_rotation_ids_json))) STRICT;

CREATE TABLE event_deletion_receipts (
  command_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  source_operation_day_id TEXT NOT NULL,
  target_operation_day_id TEXT NOT NULL,
  target_version INTEGER NOT NULL CHECK (target_version >= 0),
  actor_device_id TEXT NOT NULL,
  browser_binding_hash TEXT CHECK (
    browser_binding_hash IS NULL OR length(browser_binding_hash) = 64
  ),
  legacy_credential_hash TEXT CHECK (
    legacy_credential_hash IS NULL OR length(legacy_credential_hash) = 64
  ),
  completed_at TEXT NOT NULL,
  r2_cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (r2_cleanup_pending IN (0, 1)),
  logo_object_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(logo_object_keys_json)),
  response_json TEXT NOT NULL CHECK (json_valid(response_json))
) STRICT;

CREATE TABLE fids_preferences (
  operator_account_id TEXT NOT NULL,
  operation_day_id TEXT NOT NULL,
  visible_rows INTEGER NOT NULL DEFAULT 8 CHECK (visible_rows BETWEEN 4 AND 20),
  layout TEXT NOT NULL DEFAULT 'SINGLE' CHECK (layout IN ('SINGLE', 'DOUBLE')),
  theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('SYSTEM', 'LIGHT', 'DARK')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, view_mode TEXT NOT NULL DEFAULT 'FIXED_PAGE'
  CHECK (view_mode IN ('FIXED_PAGE', 'SPLIT')), priority_group_count INTEGER NOT NULL DEFAULT 3
  CHECK (priority_group_count BETWEEN 1 AND 19), rotation_interval_seconds INTEGER NOT NULL DEFAULT 12
  CHECK (rotation_interval_seconds BETWEEN 5 AND 60), content_filter_json TEXT NOT NULL DEFAULT '{"productIds":[],"gateIds":[]}'
  CHECK (
    json_valid(content_filter_json)
    AND json_type(content_filter_json) = 'object'
    AND json_type(content_filter_json, '$.productIds') = 'array'
    AND json_type(content_filter_json, '$.gateIds') = 'array'
  ), group_shared_flights INTEGER NOT NULL DEFAULT 0
  CHECK (group_shared_flights IN (0, 1)),
  PRIMARY KEY (operator_account_id, operation_day_id),
  FOREIGN KEY (operator_account_id) REFERENCES operator_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (operation_day_id) REFERENCES operation_days(id) ON DELETE CASCADE
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
  updated_at TEXT NOT NULL, queue_position INTEGER CHECK (queue_position > 0), precalled_at TEXT, precall_trigger TEXT, precall_decision_status TEXT
  CHECK (
    precall_decision_status IS NULL
    OR precall_decision_status IN ('WAITING', 'PREPARE', 'GO_TO_GATE')
  ), precall_decision_reason TEXT
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
  ), precall_decision_at TEXT, precall_predicted_boarding_at TEXT, precall_adaptive_lead_minutes INTEGER
  CHECK (
    precall_adaptive_lead_minutes IS NULL
    OR precall_adaptive_lead_minutes >= 0
  ), product_id TEXT REFERENCES products(id) ON DELETE RESTRICT, precall_gate_id TEXT REFERENCES gates(id) ON DELETE SET NULL, precall_dispatch_reason TEXT
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
  ), precall_adaptive_base_lead_minutes INTEGER
  CHECK (
    precall_adaptive_base_lead_minutes IS NULL
    OR precall_adaptive_base_lead_minutes >= 0
  ), precall_gate_travel_lead_minutes INTEGER
  CHECK (
    precall_gate_travel_lead_minutes IS NULL
    OR precall_gate_travel_lead_minutes BETWEEN 0 AND 30
  ), precall_effective_lead_minutes INTEGER
  CHECK (precall_effective_lead_minutes IS NULL OR precall_effective_lead_minutes >= 0), precall_boarding_window_lower_at TEXT, precall_boarding_window_upper_at TEXT,
  UNIQUE (operation_day_id, resource_group_id, communication_number)
) STRICT;

CREATE TABLE flight_line_assist_claims (
  operation_day_id TEXT NOT NULL,
  aircraft_id TEXT NOT NULL,
  operator_account_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (operation_day_id, aircraft_id),
  UNIQUE (operation_day_id, operator_account_id),
  FOREIGN KEY (operation_day_id) REFERENCES operation_days(id) ON DELETE CASCADE,
  FOREIGN KEY (aircraft_id) REFERENCES aircraft(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_account_id) REFERENCES operator_accounts(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE forecast_snapshots (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  rotation_id TEXT NOT NULL REFERENCES rotations(id) ON DELETE RESTRICT,
  operation_day_version INTEGER NOT NULL CHECK (operation_day_version >= 0),
  captured_at TEXT NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('STABLE', 'CHANGING', 'UNCERTAIN')),
  lower_minutes INTEGER NOT NULL CHECK (lower_minutes >= 0),
  upper_minutes INTEGER NOT NULL CHECK (upper_minutes >= 0),
  predicted_boarding_at TEXT,
  predicted_departure_at TEXT,
  predicted_landing_at TEXT,
  predicted_completion_at TEXT
, trigger_event_type TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN', data_basis_scope TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN'
  CHECK (data_basis_scope IN (
    'AIRCRAFT_PRODUCT_HISTORY',
    'PRODUCT_HISTORY',
    'REFERENCE_ONLY',
    'LEGACY_UNKNOWN'
  )), sample_size INTEGER NOT NULL DEFAULT 0
  CHECK (sample_size >= 0), data_age_minutes REAL NOT NULL DEFAULT 0
  CHECK (data_age_minutes >= 0), active_capacity INTEGER NOT NULL DEFAULT 0
  CHECK (active_capacity >= 0), reference_duration_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (reference_duration_minutes >= 0), product_id TEXT
  REFERENCES products(id) ON DELETE SET NULL, assumed_aircraft_id TEXT
  REFERENCES aircraft(id) ON DELETE SET NULL, boarding_minutes INTEGER
  CHECK (boarding_minutes IS NULL OR boarding_minutes BETWEEN 0 AND 120), deboarding_minutes INTEGER
  CHECK (deboarding_minutes IS NULL OR deboarding_minutes BETWEEN 0 AND 120), buffer_minutes INTEGER
  CHECK (buffer_minutes IS NULL OR buffer_minutes BETWEEN 0 AND 120), boarding_source TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN', deboarding_source TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN', buffer_source TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN', dispatch_plan_id TEXT, dispatch_plan_revision TEXT, dispatch_batch_id TEXT, dispatch_order INTEGER
  CHECK (dispatch_order IS NULL OR dispatch_order > 0), dispatch_wave INTEGER
  CHECK (dispatch_wave IS NULL OR dispatch_wave > 0), dispatch_lane_id TEXT, dispatch_group_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(dispatch_group_ids_json)), dispatch_occupied_seats INTEGER
  CHECK (dispatch_occupied_seats IS NULL OR dispatch_occupied_seats > 0), dispatch_available_seats INTEGER
  CHECK (dispatch_available_seats IS NULL OR dispatch_available_seats >= 0), dispatch_commitment_level TEXT
  CHECK (
    dispatch_commitment_level IS NULL
    OR dispatch_commitment_level IN ('WAITING', 'PREPARE', 'COME_TO_FLIGHT_LINE')
  ), dispatch_decision_reasons_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(dispatch_decision_reasons_json)), dispatch_projected_overtake_count INTEGER NOT NULL DEFAULT 0
  CHECK (dispatch_projected_overtake_count >= 0), dispatch_unplanned_reason TEXT
  CHECK (
    dispatch_unplanned_reason IS NULL
    OR dispatch_unplanned_reason IN (
      'NO_FORECAST_CAPACITY',
      'WAITING_FOR_FITTING_LANE',
      'WAITING_FOR_PRODUCT_FAIRNESS',
      'NOT_IN_NEAR_DISPATCH_BATCH',
      'COMMITMENT_LOCKED'
    )
  ), planning_run_id TEXT
  REFERENCES planning_runs(id) ON DELETE RESTRICT, dispatch_confirmed_overtake_count INTEGER NOT NULL DEFAULT 0
  CHECK (dispatch_confirmed_overtake_count >= 0)) STRICT;

CREATE TABLE gates (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  gate_type TEXT NOT NULL DEFAULT 'FLIGHT_LINE' CHECK (gate_type IN ('FLIGHT_LINE', 'BOARDING', 'DISPLAY_ONLY')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, display_filter_json TEXT NOT NULL
  DEFAULT '{"productIds":[],"rotationStatuses":[]}'
  CHECK (json_valid(display_filter_json)), travel_lead_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (travel_lead_minutes BETWEEN 0 AND 30),
  UNIQUE (operation_day_id, label)
) STRICT;

CREATE TABLE idempotency_receipts (
  command_id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json))
) STRICT;

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
, operations_end_at TEXT, operational_interrupted INTEGER NOT NULL DEFAULT 0
  CHECK (operational_interrupted IN (0, 1)), sale_opens_at TEXT, no_show_after_minutes INTEGER NOT NULL DEFAULT 10
  CHECK (no_show_after_minutes BETWEEN 1 AND 120), notification_lead_minutes INTEGER NOT NULL DEFAULT 15
  CHECK (notification_lead_minutes BETWEEN 1 AND 240), child_reference_weight_kg REAL NOT NULL DEFAULT 35
  CHECK (child_reference_weight_kg > 0), normal_reference_weight_kg REAL NOT NULL DEFAULT 80
  CHECK (normal_reference_weight_kg > 0), heavy_reference_weight_kg REAL NOT NULL DEFAULT 110
  CHECK (heavy_reference_weight_kg > 0), planned_boarding_minutes INTEGER NOT NULL DEFAULT 8
  CHECK (planned_boarding_minutes BETWEEN 1 AND 120), planned_deboarding_minutes INTEGER NOT NULL DEFAULT 5
  CHECK (planned_deboarding_minutes BETWEEN 1 AND 120), planned_buffer_minutes INTEGER NOT NULL DEFAULT 3
  CHECK (planned_buffer_minutes BETWEEN 0 AND 120), aerodrome TEXT NOT NULL DEFAULT '', archived_at TEXT, template_source_id TEXT REFERENCES operation_days(id) ON DELETE SET NULL, max_ticket_deferrals INTEGER NOT NULL DEFAULT 2
  CHECK (max_ticket_deferrals BETWEEN 1 AND 10), automatic_precall_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (automatic_precall_enabled IN (0, 1)), precall_lead_minutes INTEGER NOT NULL DEFAULT 15
  CHECK (precall_lead_minutes BETWEEN 1 AND 240), max_gate_wait_minutes INTEGER NOT NULL DEFAULT 20
  CHECK (max_gate_wait_minutes BETWEEN 1 AND 120), precall_min_quality TEXT NOT NULL DEFAULT 'CHANGING'
  CHECK (precall_min_quality IN ('STABLE', 'CHANGING')), precall_gate_cooldown_minutes INTEGER NOT NULL DEFAULT 2
  CHECK (precall_gate_cooldown_minutes BETWEEN 0 AND 60), departed_visibility_seconds INTEGER NOT NULL DEFAULT 15
  CHECK (departed_visibility_seconds BETWEEN 5 AND 900), logo_object_key TEXT, logo_media_type TEXT, logo_updated_at TEXT, logo_dark_object_key TEXT, logo_dark_media_type TEXT, operations_start_at TEXT) STRICT;

CREATE TABLE operational_blocks (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('EVENT', 'RESOURCE_GROUP', 'AIRCRAFT')),
  scope_id TEXT NOT NULL,
  block_type TEXT NOT NULL CHECK (block_type IN ('WEATHER_NOTICE', 'INTERRUPTION', 'PAUSE', 'REFUELING')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CLEARED')),
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expected_review_at TEXT,
  cleared_at TEXT,
  device_id TEXT NOT NULL
, planned_operation_id TEXT
  REFERENCES planned_operational_constraints(id) ON DELETE RESTRICT) STRICT;

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
, recorded_after_outage INTEGER NOT NULL DEFAULT 0
  CHECK (recorded_after_outage IN (0, 1)), original_occurred_at TEXT, recovery_batch_id TEXT, paper_reference TEXT) STRICT;

CREATE TABLE "operator_accounts" (
  id TEXT PRIMARY KEY,
  login_code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN (
    'CASHIER', 'FLIGHT_LINE', 'FLIGHT_DIRECTOR', 'ADMIN', 'DISPLAY'
  )),
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, deleted_at TEXT) STRICT;

CREATE TABLE operator_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES operator_accounts(id) ON DELETE CASCADE,
  session_version INTEGER NOT NULL CHECK (session_version > 0),
  token_hash TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (idle_expires_at > created_at),
  CHECK (absolute_expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
) STRICT;

CREATE TABLE outage_recovery_batches (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  created_by_device_id TEXT NOT NULL REFERENCES paired_devices(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  simulated_against_version INTEGER NOT NULL CHECK (simulated_against_version >= 0),
  status TEXT NOT NULL CHECK (status IN ('STAGED', 'CONFLICTED', 'APPROVED', 'APPLYING', 'APPLIED', 'REJECTED')),
  simulation_json TEXT NOT NULL CHECK (json_valid(simulation_json)),
  approved_by_device_id TEXT REFERENCES paired_devices(id) ON DELETE RESTRICT,
  approved_at TEXT,
  applied_at TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
) STRICT;

CREATE TABLE outage_recovery_entries (
  id TEXT PRIMARY KEY,
  source_entry_id TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES outage_recovery_batches(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('PAPER_SALE', 'ROTATION_CALLED', 'ROTATION_IN_FLIGHT', 'ROTATION_LANDED', 'ROTATION_COMPLETED')),
  original_occurred_at TEXT NOT NULL,
  paper_sequence INTEGER NOT NULL CHECK (paper_sequence > 0),
  paper_reference TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'STAGED' CHECK (status IN ('STAGED', 'CONFLICT', 'APPLIED')),
  conflict_json TEXT CHECK (conflict_json IS NULL OR json_valid(conflict_json)),
  applied_event_sequence INTEGER REFERENCES operational_events(sequence) ON DELETE RESTRICT
) STRICT;

CREATE TABLE outage_recovery_references (
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  paper_reference TEXT NOT NULL,
  ticket_group_id TEXT NOT NULL REFERENCES ticket_groups(id) ON DELETE RESTRICT,
  rotation_id TEXT NOT NULL REFERENCES rotations(id) ON DELETE RESTRICT,
  current_state TEXT NOT NULL CHECK (current_state IN ('DRAFT', 'CALLED', 'IN_FLIGHT', 'LANDED', 'COMPLETED')),
  last_source_entry_id TEXT NOT NULL,
  created_by_batch_id TEXT NOT NULL REFERENCES outage_recovery_batches(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (operation_day_id, paper_reference),
  UNIQUE (operation_day_id, rotation_id)
) STRICT;

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  published_at TEXT
) STRICT;

CREATE TABLE paired_devices (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CASHIER', 'FLIGHT_LINE', 'FLIGHT_DIRECTOR', 'ADMIN', 'DISPLAY')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  paired_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  credential_hash TEXT,
  CHECK (revoked_at IS NULL OR active = 0)
) STRICT;

CREATE TABLE pilots (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  operational_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)), pause_expected_review_at TEXT, operational_note TEXT NOT NULL DEFAULT '',
  UNIQUE (operation_day_id, operational_code)
) STRICT;

CREATE TABLE planned_operational_constraints (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('EVENT', 'RESOURCE_GROUP', 'AIRCRAFT', 'PILOT')),
  scope_id TEXT NOT NULL,
  constraint_kind TEXT NOT NULL
    CHECK (constraint_kind IN ('PAUSE', 'REFUELING', 'FLIGHT_SHOW', 'WEATHER', 'TECHNICAL', 'OTHER')),
  start_mode TEXT NOT NULL
    CHECK (start_mode IN ('TIME_WINDOW', 'AFTER_CURRENT_ROTATION')),
  earliest_start_at TEXT,
  latest_start_at TEXT,
  after_rotation_id TEXT REFERENCES rotations(id) ON DELETE RESTRICT,
  minimum_duration_minutes INTEGER NOT NULL CHECK (minimum_duration_minutes BETWEEN 1 AND 1440),
  typical_duration_minutes INTEGER NOT NULL CHECK (typical_duration_minutes BETWEEN 1 AND 1440),
  maximum_duration_minutes INTEGER NOT NULL CHECK (maximum_duration_minutes BETWEEN 1 AND 1440),
  status TEXT NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'ACTIVE', 'CLEARED', 'CANCELED')),
  reason TEXT NOT NULL,
  public_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by_device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT,
  cleared_at TEXT,
  canceled_at TEXT, effect_mode TEXT NOT NULL DEFAULT 'BLOCKING'
  CHECK (effect_mode IN ('BLOCKING', 'SLOWDOWN')), duration_multiplier_percent INTEGER
  CHECK (
    duration_multiplier_percent IS NULL
    OR duration_multiplier_percent BETWEEN 110 AND 300
  ), recurring_rule_id TEXT
  REFERENCES recurring_operational_rules(id) ON DELETE RESTRICT, recurrence_sequence INTEGER
  CHECK (recurrence_sequence IS NULL OR recurrence_sequence > 0),
  CHECK (minimum_duration_minutes <= typical_duration_minutes),
  CHECK (typical_duration_minutes <= maximum_duration_minutes),
  CHECK (
    (start_mode = 'TIME_WINDOW'
      AND earliest_start_at IS NOT NULL
      AND latest_start_at IS NOT NULL
      AND after_rotation_id IS NULL)
    OR
    (start_mode = 'AFTER_CURRENT_ROTATION'
      AND earliest_start_at IS NULL
      AND latest_start_at IS NULL
      AND after_rotation_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE planning_chunks (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  chunk_kind TEXT NOT NULL CHECK (chunk_kind IN (
    'EVENT_CONFIGURATION',
    'ROTATIONS_QUEUE',
    'CAPACITIES',
    'DURATION_SAMPLES',
    'OPERATIONAL_CONSTRAINTS',
    'PREVIOUS_FORECAST_STATE',
    'PREVIOUS_DISPATCH_STATE',
    'DISPATCH_RESULT',
    'PRECALL_RESULT'
  )),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(operation_day_id, chunk_kind, schema_version, payload_hash)
) STRICT;

CREATE TABLE planning_contexts (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  operation_day_version INTEGER NOT NULL CHECK (operation_day_version >= 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  previous_context_id TEXT REFERENCES planning_contexts(id) ON DELETE RESTRICT,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64),
  anchor_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(operation_day_id, operation_day_version, schema_version)
) STRICT;

CREATE TABLE planning_runs (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  operation_day_version INTEGER NOT NULL CHECK (operation_day_version >= 0),
  context_id TEXT NOT NULL REFERENCES planning_contexts(id) ON DELETE RESTRICT,
  previous_run_id TEXT REFERENCES planning_runs(id) ON DELETE RESTRICT,
  anchor_run_id TEXT REFERENCES planning_runs(id) ON DELETE RESTRICT,
  replay_distance INTEGER NOT NULL CHECK (replay_distance BETWEEN 0 AND 10),
  calculation_now TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  trigger_event_type TEXT NOT NULL,
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('REFERENCE', 'CHANGE', 'ANCHOR')),
  anchor_reason TEXT,
  application_version TEXT NOT NULL,
  requirements_version TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  dispatch_plan_revision TEXT NOT NULL,
  forecast_digest TEXT NOT NULL CHECK (length(forecast_digest) = 64),
  forecast_semantic_digest TEXT NOT NULL CHECK (length(forecast_semantic_digest) = 64),
  precall_digest TEXT NOT NULL CHECK (length(precall_digest) = 64),
  previous_forecast_state_chunk_id TEXT REFERENCES planning_chunks(id) ON DELETE RESTRICT,
  previous_dispatch_state_chunk_id TEXT REFERENCES planning_chunks(id) ON DELETE RESTRICT,
  dispatch_result_chunk_id TEXT REFERENCES planning_chunks(id) ON DELETE RESTRICT,
  precall_result_chunk_id TEXT REFERENCES planning_chunks(id) ON DELETE RESTRICT,
  duration_ms REAL NOT NULL CHECK (duration_ms >= 0),
  capture_duration_ms REAL CHECK (capture_duration_ms IS NULL OR capture_duration_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('CAPTURING', 'SUCCEEDED', 'FAILED')),
  failure_code TEXT,
  CHECK (
    (status = 'FAILED' AND failure_code IS NOT NULL) OR
    (status <> 'FAILED' AND failure_code IS NULL)
  ),
  UNIQUE(operation_day_id, operation_day_version, calculation_now, trigger_event_type)
) STRICT;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  resource_group_id TEXT NOT NULL REFERENCES resource_groups(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  sale_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sale_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, reference_capacity INTEGER NOT NULL DEFAULT 1 CHECK (reference_capacity > 0), reference_duration_minutes INTEGER NOT NULL DEFAULT 20 CHECK (reference_duration_minutes > 0), sale_closes_at TEXT, capacity_warning_threshold INTEGER NOT NULL DEFAULT 12
  CHECK (capacity_warning_threshold >= 0), capacity_critical_threshold INTEGER NOT NULL DEFAULT 4
  CHECK (capacity_critical_threshold >= 0), code TEXT NOT NULL DEFAULT '', public_description TEXT NOT NULL DEFAULT '', child_companion_required INTEGER NOT NULL DEFAULT 0
  CHECK (child_companion_required IN (0, 1)), sort_order INTEGER NOT NULL DEFAULT 0, weight_classes_json TEXT NOT NULL DEFAULT '["NOT_CAPTURED"]'
  CHECK (json_valid(weight_classes_json)), gate_id TEXT REFERENCES gates(id) ON DELETE RESTRICT, promised_flight_minutes INTEGER NOT NULL DEFAULT 20
  CHECK (promised_flight_minutes > 0 AND promised_flight_minutes <= 600), planned_boarding_minutes_override INTEGER
  CHECK (planned_boarding_minutes_override IS NULL
    OR planned_boarding_minutes_override BETWEEN 0 AND 120), planned_deboarding_minutes_override INTEGER
  CHECK (planned_deboarding_minutes_override IS NULL
    OR planned_deboarding_minutes_override BETWEEN 0 AND 120), planned_buffer_minutes_override INTEGER
  CHECK (planned_buffer_minutes_override IS NULL
    OR planned_buffer_minutes_override BETWEEN 0 AND 120),
  UNIQUE (operation_day_id, name)
) STRICT;

CREATE TABLE recurring_operational_rules (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('AIRCRAFT', 'PILOT')),
  scope_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('PAUSE', 'REFUELING')),
  trigger_metric TEXT NOT NULL
    CHECK (trigger_metric IN ('COMPLETED_ROTATIONS', 'OPERATING_MINUTES')),
  interval_value INTEGER NOT NULL CHECK (interval_value BETWEEN 1 AND 100000),
  progress_value INTEGER NOT NULL DEFAULT 0 CHECK (progress_value BETWEEN 0 AND 100000),
  minimum_duration_minutes INTEGER NOT NULL CHECK (minimum_duration_minutes BETWEEN 1 AND 1440),
  typical_duration_minutes INTEGER NOT NULL CHECK (typical_duration_minutes BETWEEN 1 AND 1440),
  maximum_duration_minutes INTEGER NOT NULL CHECK (maximum_duration_minutes BETWEEN 1 AND 1440),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  sequence_number INTEGER NOT NULL DEFAULT 0 CHECK (sequence_number >= 0),
  reason TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by_device_id TEXT NOT NULL,
  last_reset_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT,
  CHECK (minimum_duration_minutes <= typical_duration_minutes),
  CHECK (typical_duration_minutes <= maximum_duration_minutes),
  CHECK (operation_kind <> 'REFUELING' OR scope_type = 'AIRCRAFT')
) STRICT;

CREATE TABLE resource_group_memberships (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  resource_group_id TEXT NOT NULL REFERENCES resource_groups(id) ON DELETE RESTRICT,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE RESTRICT,
  active_from TEXT NOT NULL,
  active_until TEXT,
  created_at TEXT NOT NULL, change_reason TEXT NOT NULL DEFAULT 'Migration', changed_by_device_id TEXT NOT NULL DEFAULT 'system-migration', current_pilot_id TEXT REFERENCES pilots(id) ON DELETE RESTRICT,
  CHECK (active_until IS NULL OR active_until > active_from)
) STRICT;

CREATE TABLE resource_groups (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, operational_note TEXT NOT NULL DEFAULT '', gate_id TEXT REFERENCES gates(id) ON DELETE RESTRICT, reference_capacity INTEGER NOT NULL DEFAULT 1
  CHECK (reference_capacity > 0), compatible_aircraft_types_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(compatible_aircraft_types_json)), automatic_precall_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (automatic_precall_enabled IN (0, 1)), short_code TEXT NOT NULL DEFAULT '',
  UNIQUE (operation_day_id, name)
) STRICT;

CREATE TABLE rotation_manifest_corrections (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  ticket_group_id TEXT NOT NULL REFERENCES ticket_groups(id) ON DELETE RESTRICT,
  source_rotation_ids_json TEXT NOT NULL CHECK (json_valid(source_rotation_ids_json)),
  target_rotation_id TEXT NOT NULL REFERENCES rotations(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  corrected_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  event_version INTEGER NOT NULL CHECK (event_version > 0)
) STRICT;

CREATE TABLE rotation_tickets (
  rotation_id TEXT NOT NULL REFERENCES rotations(id) ON DELETE RESTRICT,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (rotation_id, ticket_id)
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
, call_revoked_at TEXT, pilot_id TEXT REFERENCES pilots(id) ON DELETE RESTRICT, planned_boarding_at TEXT, planned_departure_at TEXT, planned_landing_at TEXT, planned_completion_at TEXT, predicted_boarding_at TEXT, predicted_departure_at TEXT, predicted_landing_at TEXT, predicted_completion_at TEXT, prediction_quality TEXT
  CHECK (prediction_quality IN ('STABLE', 'CHANGING', 'UNCERTAIN')), prediction_lower_minutes INTEGER
  CHECK (prediction_lower_minutes IS NULL OR prediction_lower_minutes >= 0), prediction_upper_minutes INTEGER
  CHECK (prediction_upper_minutes IS NULL OR prediction_upper_minutes >= 0), prediction_updated_at TEXT, gate_id TEXT REFERENCES gates(id) ON DELETE RESTRICT, operational_note TEXT NOT NULL DEFAULT '', usable_capacity INTEGER CHECK (usable_capacity > 0), forecast_assumed_aircraft_id TEXT
  REFERENCES aircraft(id) ON DELETE SET NULL, turnaround_product_id TEXT
  REFERENCES products(id) ON DELETE SET NULL, turnaround_aircraft_id TEXT
  REFERENCES aircraft(id) ON DELETE SET NULL, turnaround_boarding_minutes INTEGER
  CHECK (turnaround_boarding_minutes IS NULL OR turnaround_boarding_minutes BETWEEN 0 AND 120), turnaround_deboarding_minutes INTEGER
  CHECK (turnaround_deboarding_minutes IS NULL OR turnaround_deboarding_minutes BETWEEN 0 AND 120), turnaround_buffer_minutes INTEGER
  CHECK (turnaround_buffer_minutes IS NULL OR turnaround_buffer_minutes BETWEEN 0 AND 120), turnaround_boarding_source TEXT, turnaround_deboarding_source TEXT, turnaround_buffer_source TEXT, dispatch_plan_id TEXT, dispatch_plan_revision TEXT, dispatch_batch_id TEXT, dispatch_order INTEGER
  CHECK (dispatch_order IS NULL OR dispatch_order > 0), dispatch_wave INTEGER
  CHECK (dispatch_wave IS NULL OR dispatch_wave > 0), dispatch_lane_id TEXT, dispatch_group_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(dispatch_group_ids_json)), dispatch_occupied_seats INTEGER
  CHECK (dispatch_occupied_seats IS NULL OR dispatch_occupied_seats > 0), dispatch_available_seats INTEGER
  CHECK (dispatch_available_seats IS NULL OR dispatch_available_seats >= 0), dispatch_commitment_level TEXT
  CHECK (
    dispatch_commitment_level IS NULL
    OR dispatch_commitment_level IN ('WAITING', 'PREPARE', 'COME_TO_FLIGHT_LINE')
  ), dispatch_decision_reasons_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(dispatch_decision_reasons_json)), dispatch_projected_overtake_count INTEGER NOT NULL DEFAULT 0
  CHECK (dispatch_projected_overtake_count >= 0), dispatch_unplanned_reason TEXT
  CHECK (
    dispatch_unplanned_reason IS NULL
    OR dispatch_unplanned_reason IN (
      'NO_FORECAST_CAPACITY',
      'WAITING_FOR_FITTING_LANE',
      'WAITING_FOR_PRODUCT_FAIRNESS',
      'NOT_IN_NEAR_DISPATCH_BATCH',
      'COMMITMENT_LOCKED'
    )
  ), dispatch_confirmed_overtake_count INTEGER NOT NULL DEFAULT 0
  CHECK (dispatch_confirmed_overtake_count >= 0), booking_segment_order INTEGER NOT NULL DEFAULT 1
  CHECK (booking_segment_order >= 1)) STRICT;

CREATE TABLE system_reset_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
) STRICT;

-- Required technical sentinel. It is not application or demo data.
INSERT INTO system_reset_control (singleton, active) VALUES (1, 0);

CREATE TABLE system_reset_receipts (
  command_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  r2_cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (r2_cleanup_pending IN (0, 1)),
  response_json TEXT NOT NULL CHECK (json_valid(response_json))
, setup_grant_hash TEXT, setup_grant_expires_at TEXT, setup_grant_used_at TEXT, setup_browser_binding_hash TEXT) STRICT;

CREATE TABLE ticket_group_recalls (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  ticket_group_id TEXT NOT NULL REFERENCES ticket_groups(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT CHECK (end_reason IN (
    'MANUAL', 'PRESENT', 'BOARDING', 'DEFERRED', 'NO_SHOW', 'CANCELED', 'EXPIRED'
  )),
  CHECK (expires_at > started_at),
  CHECK (
    (ended_at IS NULL AND end_reason IS NULL)
    OR (ended_at IS NOT NULL AND end_reason IS NOT NULL)
  ),
  UNIQUE(ticket_group_id, sequence)
) STRICT;

CREATE TABLE ticket_groups (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  queue_sequence INTEGER NOT NULL CHECK (queue_sequence > 0),
  standby INTEGER NOT NULL DEFAULT 0 CHECK (standby IN (0, 1)),
  status TEXT NOT NULL,
  sold_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0), deferral_count INTEGER NOT NULL DEFAULT 0
  CHECK (deferral_count >= 0), communication_number INTEGER, recalled_at TEXT, recall_count INTEGER NOT NULL DEFAULT 0, public_status_code_hash TEXT, public_status_code TEXT, sold_by_operator_account_id TEXT
  REFERENCES operator_accounts(id) ON DELETE SET NULL,
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
, payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('CASH', 'CARD', 'VOUCHER', 'OTHER')), attendance_status TEXT NOT NULL DEFAULT 'NOT_CHECKED_IN'
  CHECK (attendance_status IN ('NOT_CHECKED_IN', 'CHECKED_IN')), public_code TEXT) STRICT;

CREATE TABLE "web_push_deliveries" (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  rotation_id TEXT REFERENCES rotations(id) ON DELETE CASCADE,
  ticket_group_recall_id TEXT REFERENCES ticket_group_recalls(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'PREPARE_FOR_FLIGHT', 'GO_TO_GATE', 'BOARDING_STARTED', 'FLIGHT_GROUP_CALLED',
    'ROTATION_STARTED', 'ROTATION_LANDED', 'ROTATION_COMPLETED', 'TICKET_GROUP_RECALL'
  )),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'EXPIRED')),
  queued_at TEXT NOT NULL,
  last_attempt_at TEXT,
  delivered_at TEXT,
  CHECK (
    (
      notification_type = 'TICKET_GROUP_RECALL'
      AND rotation_id IS NULL
      AND ticket_group_recall_id IS NOT NULL
    )
    OR (
      notification_type <> 'TICKET_GROUP_RECALL'
      AND rotation_id IS NOT NULL
      AND ticket_group_recall_id IS NULL
    )
  )
) STRICT;

CREATE TABLE web_push_subscriptions (
  id TEXT PRIMARY KEY,
  operation_day_id TEXT NOT NULL REFERENCES operation_days(id),
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  delete_after TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  updated_at TEXT NOT NULL
, ticket_group_id TEXT
  REFERENCES ticket_groups(id), target_kind TEXT NOT NULL DEFAULT 'GROUP'
  CHECK (target_kind IN ('TICKET', 'GROUP')), origin TEXT);

CREATE UNIQUE INDEX dispatch_recommendation_leases_active_aircraft
  ON dispatch_recommendation_leases(operation_day_id, aircraft_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX dispatch_recommendation_leases_active_batch
  ON dispatch_recommendation_leases(operation_day_id, dispatch_batch_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX dispatch_recommendation_leases_active_device
  ON dispatch_recommendation_leases(operation_day_id, operator_account_id, device_id)
  WHERE status = 'ACTIVE';

CREATE INDEX dispatch_recommendation_leases_active_expiry
  ON dispatch_recommendation_leases(operation_day_id, status, expires_at);

CREATE INDEX dispatch_recommendation_leases_owner
  ON dispatch_recommendation_leases(operation_day_id, operator_account_id, device_id, status);

CREATE INDEX flight_line_assist_claims_by_operator
  ON flight_line_assist_claims(operation_day_id, operator_account_id, expires_at);

CREATE INDEX idx_aircraft_product_turnaround_overrides_product
  ON aircraft_product_turnaround_overrides(operation_day_id, product_id, aircraft_id);

CREATE INDEX idx_analysis_archive_events_archive
  ON analysis_archive_events(archive_id, occurred_at, id);

CREATE INDEX idx_analysis_archives_cleanup
  ON analysis_archives(status, expires_at);

CREATE INDEX idx_analysis_archives_event_status
  ON analysis_archives(operation_day_id, status, requested_at DESC);

CREATE INDEX idx_event_deletion_receipts_target
  ON event_deletion_receipts(target_operation_day_id, completed_at);

CREATE INDEX idx_events_day_sequence ON operational_events(operation_day_id, sequence);

CREATE INDEX idx_fids_preferences_operation_day
  ON fids_preferences(operation_day_id, operator_account_id);

CREATE INDEX idx_flight_groups_event_product
  ON flight_groups(operation_day_id, product_id, status, communication_number);

CREATE INDEX idx_flight_groups_operational_queue
  ON flight_groups(operation_day_id, resource_group_id, status, queue_position);

CREATE INDEX idx_flight_groups_precall
  ON flight_groups(operation_day_id, resource_group_id, precalled_at);

CREATE INDEX idx_flight_groups_precall_decision
  ON flight_groups(operation_day_id, resource_group_id, precall_decision_status);

CREATE INDEX idx_flight_groups_queue ON flight_groups(operation_day_id, resource_group_id, status, communication_number);

CREATE INDEX idx_forecast_snapshots_event_rotation
  ON forecast_snapshots(operation_day_id, rotation_id, captured_at DESC);

CREATE INDEX idx_forecast_snapshots_planning_run
  ON forecast_snapshots(planning_run_id);

CREATE INDEX idx_gates_event_active ON gates(operation_day_id, active, sort_order);

CREATE INDEX idx_manifest_corrections_event_time
  ON rotation_manifest_corrections(operation_day_id, corrected_at, id);

CREATE INDEX idx_membership_current_pilot
  ON resource_group_memberships(operation_day_id, aircraft_id, current_pilot_id)
  WHERE active_until IS NULL AND current_pilot_id IS NOT NULL;

CREATE INDEX idx_memberships_history
  ON resource_group_memberships(operation_day_id, aircraft_id, active_from, active_until);

CREATE INDEX idx_operation_days_date_archive
  ON operation_days(archived_at, event_date DESC);

CREATE INDEX idx_operational_blocks_active
  ON operational_blocks(operation_day_id, scope_type, scope_id, status);

CREATE INDEX idx_operational_blocks_plan
  ON operational_blocks(planned_operation_id, status);

CREATE INDEX idx_operator_accounts_active_role
  ON operator_accounts(active, role, login_code);

CREATE INDEX idx_operator_accounts_visible_role
  ON operator_accounts(deleted_at, role, login_code);

CREATE INDEX idx_operator_sessions_account_active
  ON operator_sessions(account_id, revoked_at, absolute_expires_at);

CREATE INDEX idx_operator_sessions_token_active
  ON operator_sessions(token_hash, revoked_at, idle_expires_at, absolute_expires_at);

CREATE INDEX idx_outage_recovery_batches_event
  ON outage_recovery_batches(operation_day_id, status, created_at);

CREATE INDEX idx_outage_recovery_entries_batch
  ON outage_recovery_entries(batch_id, original_occurred_at, paper_sequence);

CREATE INDEX idx_outage_recovery_references_state
  ON outage_recovery_references(operation_day_id, current_state, paper_reference);

CREATE INDEX idx_outbox_unpublished ON outbox(created_at) WHERE published_at IS NULL;

CREATE INDEX idx_paired_devices_credential ON paired_devices(operation_day_id, id, active, credential_hash);

CREATE INDEX idx_paired_devices_event_active ON paired_devices(operation_day_id, active, role);

CREATE INDEX idx_pilots_available
  ON pilots(operation_day_id, active, paused, operational_code);

CREATE INDEX idx_pilots_event_active ON pilots(operation_day_id, active, operational_code);

CREATE INDEX idx_planned_operational_constraints_event_status
  ON planned_operational_constraints(operation_day_id, status, latest_start_at);

CREATE UNIQUE INDEX idx_planned_operational_constraints_recurring_sequence
  ON planned_operational_constraints(recurring_rule_id, recurrence_sequence)
  WHERE recurring_rule_id IS NOT NULL;

CREATE INDEX idx_planned_operational_constraints_scope
  ON planned_operational_constraints(operation_day_id, scope_type, scope_id, status);

CREATE INDEX idx_planning_chunks_event_kind
  ON planning_chunks(operation_day_id, chunk_kind, created_at);

CREATE INDEX idx_planning_contexts_event_version
  ON planning_contexts(operation_day_id, operation_day_version DESC);

CREATE INDEX idx_planning_runs_anchor
  ON planning_runs(operation_day_id, anchor_run_id, replay_distance);

CREATE INDEX idx_planning_runs_anchor_run
  ON planning_runs(anchor_run_id);

CREATE INDEX idx_planning_runs_dispatch_revision
  ON planning_runs(operation_day_id, dispatch_plan_revision);

CREATE INDEX idx_planning_runs_event_time
  ON planning_runs(operation_day_id, calculation_now DESC);

CREATE INDEX idx_planning_runs_previous_run
  ON planning_runs(previous_run_id);

CREATE UNIQUE INDEX idx_recurring_operational_rules_active_target_kind
  ON recurring_operational_rules(operation_day_id, scope_type, scope_id, operation_kind)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_recurring_operational_rules_event_status
  ON recurring_operational_rules(operation_day_id, status, scope_type, scope_id);

CREATE UNIQUE INDEX idx_resource_groups_operation_day_short_code
  ON resource_groups(operation_day_id, short_code);

CREATE INDEX idx_rotations_dispatch_plan
  ON rotations(operation_day_id, dispatch_plan_revision, dispatch_order);

CREATE INDEX idx_rotations_event_gate ON rotations(operation_day_id, gate_id, status);

CREATE INDEX idx_rotations_event_status ON rotations(operation_day_id, status, created_at);

CREATE INDEX idx_system_reset_receipts_setup_grant
  ON system_reset_receipts(setup_grant_hash, setup_grant_expires_at, setup_grant_used_at);

CREATE INDEX idx_ticket_group_recalls_event_active
  ON ticket_group_recalls(operation_day_id, expires_at)
  WHERE ended_at IS NULL;

CREATE INDEX idx_ticket_groups_cashier_account_list
  ON ticket_groups(operation_day_id, sold_by_operator_account_id, sold_at DESC, id DESC);

CREATE INDEX idx_ticket_groups_cashier_list
  ON ticket_groups(operation_day_id, sold_at DESC, id DESC);

CREATE UNIQUE INDEX idx_ticket_groups_event_communication
  ON ticket_groups(operation_day_id, communication_number)
  WHERE communication_number IS NOT NULL;

CREATE UNIQUE INDEX idx_ticket_groups_public_status_code
  ON ticket_groups(public_status_code)
  WHERE public_status_code IS NOT NULL;

CREATE UNIQUE INDEX idx_ticket_groups_public_status_code_hash
  ON ticket_groups(public_status_code_hash)
  WHERE public_status_code_hash IS NOT NULL;

CREATE INDEX idx_ticket_groups_queue ON ticket_groups(operation_day_id, product_id, status, queue_sequence);

CREATE INDEX idx_tickets_attendance ON tickets(ticket_group_id, attendance_status);

CREATE UNIQUE INDEX idx_tickets_public_code ON tickets(public_code) WHERE public_code IS NOT NULL;

CREATE INDEX idx_web_push_deliveries_pending
  ON web_push_deliveries(status, queued_at) WHERE status = 'PENDING';

CREATE INDEX idx_web_push_target_active
  ON web_push_subscriptions(target_kind, status, delete_after);

CREATE INDEX idx_web_push_ticket_active
  ON web_push_subscriptions(ticket_id, status, delete_after);

CREATE INDEX idx_web_push_ticket_group_active
  ON web_push_subscriptions(ticket_group_id, status, delete_after);

CREATE UNIQUE INDEX uq_aircraft_one_active_resource_group
  ON resource_group_memberships(operation_day_id, aircraft_id)
  WHERE active_until IS NULL;

CREATE UNIQUE INDEX uq_products_event_code ON products(operation_day_id, code);

CREATE UNIQUE INDEX uq_ticket_group_recalls_active
  ON ticket_group_recalls(ticket_group_id)
  WHERE ended_at IS NULL;

CREATE UNIQUE INDEX uq_ticket_one_active_rotation
  ON rotation_tickets(ticket_id)
  WHERE released_at IS NULL;

CREATE UNIQUE INDEX uq_web_push_deliveries_recall
  ON web_push_deliveries(subscription_id, ticket_group_recall_id)
  WHERE ticket_group_recall_id IS NOT NULL;

CREATE UNIQUE INDEX uq_web_push_deliveries_rotation
  ON web_push_deliveries(subscription_id, rotation_id, notification_type)
  WHERE rotation_id IS NOT NULL;

CREATE TRIGGER aircraft_product_turnaround_override_aircraft_event_insert
BEFORE INSERT ON aircraft_product_turnaround_overrides
WHEN NOT EXISTS (
  SELECT 1 FROM resource_group_memberships membership
   WHERE membership.aircraft_id = NEW.aircraft_id
     AND membership.operation_day_id = NEW.operation_day_id
)
BEGIN
  SELECT RAISE(ABORT, 'turnaround override aircraft event mismatch');
END;

CREATE TRIGGER aircraft_product_turnaround_override_product_event_insert
BEFORE INSERT ON aircraft_product_turnaround_overrides
WHEN NOT EXISTS (
  SELECT 1 FROM products p
   WHERE p.id = NEW.product_id AND p.operation_day_id = NEW.operation_day_id
)
BEGIN
  SELECT RAISE(ABORT, 'turnaround override product event mismatch');
END;

CREATE TRIGGER analysis_archive_events_no_delete
BEFORE DELETE ON analysis_archive_events
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'analysis_archive_events is append-only');
END;

CREATE TRIGGER analysis_archive_events_no_update
BEFORE UPDATE ON analysis_archive_events
BEGIN
  SELECT RAISE(ABORT, 'analysis_archive_events is append-only');
END;

CREATE TRIGGER forecast_snapshots_no_delete
BEFORE DELETE ON forecast_snapshots
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'forecast_snapshots is append-only');
END;

CREATE TRIGGER forecast_snapshots_no_update
BEFORE UPDATE ON forecast_snapshots
BEGIN
  SELECT RAISE(ABORT, 'forecast_snapshots is append-only');
END;

CREATE TRIGGER operational_events_no_delete
BEFORE DELETE ON operational_events
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'operational_events is append-only');
END;

CREATE TRIGGER operational_events_no_update
BEFORE UPDATE ON operational_events
BEGIN
  SELECT RAISE(ABORT, 'operational_events is append-only');
END;

CREATE TRIGGER planned_operational_constraints_effect_insert
BEFORE INSERT ON planned_operational_constraints
WHEN (
  (NEW.effect_mode = 'BLOCKING' AND NEW.duration_multiplier_percent IS NOT NULL)
  OR
  (NEW.effect_mode = 'SLOWDOWN' AND NEW.duration_multiplier_percent IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'operational plan effect configuration is invalid');
END;

CREATE TRIGGER planned_operational_constraints_effect_update
BEFORE UPDATE OF effect_mode, duration_multiplier_percent ON planned_operational_constraints
WHEN (
  (NEW.effect_mode = 'BLOCKING' AND NEW.duration_multiplier_percent IS NOT NULL)
  OR
  (NEW.effect_mode = 'SLOWDOWN' AND NEW.duration_multiplier_percent IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'operational plan effect configuration is invalid');
END;

CREATE TRIGGER planning_chunks_no_delete
BEFORE DELETE ON planning_chunks
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'planning_chunks is append-only');
END;

CREATE TRIGGER planning_chunks_no_update
BEFORE UPDATE ON planning_chunks
BEGIN
  SELECT RAISE(ABORT, 'planning_chunks is append-only');
END;

CREATE TRIGGER planning_contexts_no_delete
BEFORE DELETE ON planning_contexts
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'planning_contexts is append-only');
END;

CREATE TRIGGER planning_contexts_no_update
BEFORE UPDATE ON planning_contexts
BEGIN
  SELECT RAISE(ABORT, 'planning_contexts is append-only');
END;

CREATE TRIGGER planning_runs_no_delete
BEFORE DELETE ON planning_runs
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'planning_runs is append-only');
END;

CREATE TRIGGER planning_runs_restrict_update
BEFORE UPDATE ON planning_runs
WHEN NOT (
  OLD.status = 'CAPTURING' AND NEW.status IN ('SUCCEEDED', 'FAILED') AND
  OLD.id = NEW.id AND OLD.operation_day_id = NEW.operation_day_id AND
  OLD.operation_day_version = NEW.operation_day_version AND OLD.context_id = NEW.context_id AND
  OLD.calculation_now = NEW.calculation_now AND OLD.capture_mode = NEW.capture_mode
)
BEGIN
  SELECT RAISE(ABORT, 'planning_runs is append-only after capture');
END;

CREATE TRIGGER rotation_manifest_corrections_no_delete
BEFORE DELETE ON rotation_manifest_corrections
WHEN COALESCE((SELECT active FROM system_reset_control WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'rotation_manifest_corrections is append-only');
END;

CREATE TRIGGER rotation_manifest_corrections_no_update
BEFORE UPDATE ON rotation_manifest_corrections
BEGIN
  SELECT RAISE(ABORT, 'rotation_manifest_corrections is append-only');
END;

CREATE TRIGGER rotation_tickets_product_pure_insert
BEFORE INSERT ON rotation_tickets
WHEN NEW.released_at IS NULL
  AND EXISTS (
    SELECT 1
      FROM rotations r
      JOIN flight_groups fg ON fg.id = r.flight_group_id
      JOIN tickets t ON t.id = NEW.ticket_id
      JOIN ticket_groups tg ON tg.id = t.ticket_group_id
     WHERE r.id = NEW.rotation_id
       AND r.status NOT IN ('COMPLETED', 'CANCELED')
       AND (fg.product_id IS NULL OR fg.product_id <> tg.product_id)
  )
BEGIN
  SELECT RAISE(ABORT, 'active rotation ticket product mismatch');
END;

CREATE TRIGGER rotation_tickets_product_pure_reactivate
BEFORE UPDATE OF released_at ON rotation_tickets
WHEN NEW.released_at IS NULL
  AND OLD.released_at IS NOT NULL
  AND EXISTS (
    SELECT 1
      FROM rotations r
      JOIN flight_groups fg ON fg.id = r.flight_group_id
      JOIN tickets t ON t.id = NEW.ticket_id
      JOIN ticket_groups tg ON tg.id = t.ticket_group_id
     WHERE r.id = NEW.rotation_id
       AND r.status NOT IN ('COMPLETED', 'CANCELED')
       AND (fg.product_id IS NULL OR fg.product_id <> tg.product_id)
  )
BEGIN
  SELECT RAISE(ABORT, 'active rotation ticket product mismatch');
END;
