INSERT OR IGNORE INTO operation_days (
  id, name, event_date, time_zone, status, emergency_mode, operational_note, version, created_at, updated_at
) VALUES (
  'demo-2026',
  'Synthetischer Flugtag 2026',
  '2026-07-11',
  'Europe/Berlin',
  'PREPARATION',
  0,
  'Nur technischer Seed – keine Echtdaten',
  0,
  '2026-07-11T08:00:00.000Z',
  '2026-07-11T08:00:00.000Z'
);

INSERT OR IGNORE INTO paired_devices (
  id, operation_day_id, label, role, active, paired_at, last_seen_at
) VALUES (
  'technical-scaffold', 'demo-2026', 'Technisches Administrationsgerät', 'ADMIN', 1,
  '2026-07-11T08:00:00.000Z', '2026-07-11T08:00:00.000Z'
);

INSERT OR IGNORE INTO paired_devices (id, operation_day_id, label, role, active, paired_at, last_seen_at)
VALUES
  ('cashier-tablet-1', 'demo-2026', 'Kasse 1', 'CASHIER', 1, '2026-07-11T08:00:00.000Z', '2026-07-11T08:00:00.000Z'),
  ('flight-line-tablet-1', 'demo-2026', 'Flight Line 1', 'FLIGHT_LINE', 1, '2026-07-11T08:00:00.000Z', '2026-07-11T08:00:00.000Z');

INSERT OR IGNORE INTO resource_groups (id, operation_day_id, name, status, version, created_at, updated_at)
VALUES ('rg-panorama', 'demo-2026', 'Panorama', 'ACTIVE', 0, '2026-07-11T08:00:00.000Z', '2026-07-11T08:00:00.000Z');

INSERT OR IGNORE INTO aircraft (id, registration, aircraft_type, passenger_seats, created_at, updated_at)
VALUES ('aircraft-a', 'D-EDEM', 'SYNTHETIC-DEMO', 4, '2026-07-11T08:00:00.000Z', '2026-07-11T08:00:00.000Z');

INSERT OR IGNORE INTO resource_group_memberships
  (id, operation_day_id, resource_group_id, aircraft_id, active_from, active_until, created_at)
VALUES ('membership-a', 'demo-2026', 'rg-panorama', 'aircraft-a', '2026-07-11T08:00:00.000Z', NULL, '2026-07-11T08:00:00.000Z');

INSERT OR IGNORE INTO products
  (id, operation_day_id, resource_group_id, name, price_cents, sale_enabled, reference_capacity,
   reference_duration_minutes, created_at, updated_at)
VALUES ('panorama-20', 'demo-2026', 'rg-panorama', '20 Min. Panorama', 4500, 1, 4, 20,
        '2026-07-11T08:00:00.000Z', '2026-07-11T08:00:00.000Z');

-- Hashes ausschließlich synthetischer lokaler Demo-Tokens; keine Produktiv-Credentials.
UPDATE paired_devices SET credential_hash = '5077b8b10f7ee36a8bb5162d25d60ee7c6a2e474826592d5ab8f4312610a0de0'
 WHERE id = 'technical-scaffold';
UPDATE paired_devices SET credential_hash = '512d8b41c03e67c38cf5b8a6a3202d6fd6b56ed1f8c9c97ae0b818c1d4377ef3'
 WHERE id = 'cashier-tablet-1';
UPDATE paired_devices SET credential_hash = 'a123beb36cf990172441b691ca1c519f512bfc5249900f2a828eff6369d9aa21'
 WHERE id = 'flight-line-tablet-1';
