-- Synthetic browser-QA data for the V1.7.3 FIDS view. Apply only to a reset local database.
INSERT OR IGNORE INTO resource_groups
  (id, operation_day_id, name, short_code, status, gate_id, version, created_at, updated_at)
VALUES
  ('rg-oldtimer', 'demo-2026', 'Oldtimer', 'OT', 'ACTIVE', 'demo-2026-gate-main', 0,
   '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z'),
  ('rg-paused', 'demo-2026', 'Pause', 'VP', 'PAUSED', 'demo-2026-gate-main', 0,
   '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z');

INSERT OR IGNORE INTO aircraft
  (id, registration, aircraft_type, passenger_seats, operational_state,
   operational_state_changed_at, created_at, updated_at)
VALUES
  ('aircraft-fids-boarding', 'D-EQA1', 'SYNTHETIC-QA', 4, 'BOARDING',
   '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z');

INSERT OR IGNORE INTO resource_group_memberships
  (id, operation_day_id, resource_group_id, aircraft_id, active_from, active_until, created_at)
VALUES
  ('membership-fids-boarding', 'demo-2026', 'rg-oldtimer', 'aircraft-fids-boarding',
   '2026-07-22T08:00:00.000Z', NULL, '2026-07-22T08:00:00.000Z');

INSERT OR IGNORE INTO products
  (id, operation_day_id, resource_group_id, gate_id, name, code, price_cents, sale_enabled,
   reference_capacity, reference_duration_minutes, created_at, updated_at)
VALUES
  ('normal-qa', 'demo-2026', 'rg-panorama', 'demo-2026-gate-main',
   'Rundflug Normal', 'RN', 0, 0, 4, 20,
   '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z'),
  ('oldtimer-qa', 'demo-2026', 'rg-oldtimer', 'demo-2026-gate-main',
   'Oldtimer-Rundflug', 'OT', 0, 0, 4, 25,
   '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z'),
  ('paused-qa', 'demo-2026', 'rg-paused', 'demo-2026-gate-main',
   'Rundflug Pause', 'VP', 0, 0, 4, 20,
   '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z');

WITH RECURSIVE sequence(number) AS (
  SELECT 1 UNION ALL SELECT number + 1 FROM sequence WHERE number < 20
)
INSERT OR IGNORE INTO ticket_groups
  (id, operation_day_id, product_id, queue_sequence, communication_number, standby,
   status, sold_at, version)
SELECT printf('fids-qa-ticket-group-%02d', number), 'demo-2026',
       CASE WHEN number % 7 = 0 THEN 'paused-qa'
            WHEN number % 5 = 0 OR number = 2 THEN 'oldtimer-qa'
            ELSE 'normal-qa' END,
       number, 200 + number, 0, 'QUEUED', '2026-07-22T08:00:00.000Z', 0
  FROM sequence;

WITH RECURSIVE sequence(number) AS (
  SELECT 1 UNION ALL SELECT number + 1 FROM sequence WHERE number < 20
)
INSERT OR IGNORE INTO tickets
  (id, ticket_group_id, public_code_hash, status, weight_class, individual_weight_kg,
   payment_status, price_cents, created_at)
SELECT printf('fids-qa-ticket-%02d', number), printf('fids-qa-ticket-group-%02d', number),
       printf('fids-qa-hash-%02d', number), 'QUEUED', 'NOT_CAPTURED', NULL,
       'PAID', 0, '2026-07-22T08:00:00.000Z'
  FROM sequence;

WITH RECURSIVE sequence(number) AS (
  SELECT 1 UNION ALL SELECT number + 1 FROM sequence WHERE number < 20
)
INSERT OR IGNORE INTO flight_groups
  (id, operation_day_id, resource_group_id, communication_number, status,
   prediction_lower_minutes, prediction_upper_minutes, version, created_at, updated_at,
   queue_position, precalled_at)
SELECT printf('fids-qa-flight-group-%02d', number), 'demo-2026',
       CASE WHEN number % 7 = 0 THEN 'rg-paused'
            WHEN number % 5 = 0 OR number = 2 THEN 'rg-oldtimer'
            ELSE 'rg-panorama' END,
       200 + number, CASE WHEN number = 2 THEN 'CALLED' ELSE 'DRAFT' END,
       number * 5, number * 5 + 15, 0,
       '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z', number,
       CASE WHEN number = 1 THEN '2026-07-22T08:05:00.000Z' ELSE NULL END
  FROM sequence;

WITH RECURSIVE sequence(number) AS (
  SELECT 1 UNION ALL SELECT number + 1 FROM sequence WHERE number < 20
)
INSERT OR IGNORE INTO rotations
  (id, operation_day_id, flight_group_id, aircraft_id, status, called_at, version,
   created_at, updated_at, gate_id)
SELECT printf('fids-qa-rotation-%02d', number), 'demo-2026',
       printf('fids-qa-flight-group-%02d', number),
       CASE WHEN number = 2 THEN 'aircraft-fids-boarding' ELSE NULL END,
       CASE WHEN number = 2 THEN 'CALLED' ELSE 'DRAFT' END,
       CASE WHEN number = 2 THEN '2026-07-22T08:05:00.000Z' ELSE NULL END,
       0, '2026-07-22T08:00:00.000Z', '2026-07-22T08:00:00.000Z',
       'demo-2026-gate-main'
  FROM sequence;

WITH RECURSIVE sequence(number) AS (
  SELECT 1 UNION ALL SELECT number + 1 FROM sequence WHERE number < 20
)
INSERT OR IGNORE INTO rotation_tickets (rotation_id, ticket_id, assigned_at)
SELECT printf('fids-qa-rotation-%02d', number), printf('fids-qa-ticket-%02d', number),
       '2026-07-22T08:00:00.000Z'
  FROM sequence;
