ALTER TABLE products ADD COLUMN promised_flight_minutes INTEGER NOT NULL DEFAULT 20
  CHECK (promised_flight_minutes > 0 AND promised_flight_minutes <= 600);

UPDATE products
SET promised_flight_minutes = reference_duration_minutes;
