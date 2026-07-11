-- Normale Betriebsunterbrechung bleibt getrennt vom Notfallmodus.
ALTER TABLE operation_days ADD COLUMN operational_interrupted INTEGER NOT NULL DEFAULT 0
  CHECK (operational_interrupted IN (0, 1));
