-- Unterscheidet organisatorische Kurzzeit-Inaktivität von einer ausdrücklich dokumentierten
-- Betriebsunterbrechung; beide nehmen das Flugzeug konservativ aus der Kapazität.
ALTER TABLE aircraft ADD COLUMN operational_interrupted INTEGER NOT NULL DEFAULT 0
  CHECK (operational_interrupted IN (0, 1));
