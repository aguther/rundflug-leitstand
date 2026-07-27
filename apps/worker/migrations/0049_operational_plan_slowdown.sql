-- Ein Betriebsplan kann neben einer vollständigen Blockierung auch einen verlangsamten Betrieb
-- beschreiben. Der Faktor besitzt keinerlei Freigabesemantik und verändert ausschließlich die
-- Prognose noch nicht bestätigter Phasen.
--
-- Wiederherstellung: Vor einem Rollback D1 Time Travel beziehungsweise ein portables R2-Backup
-- verwenden. Bestehende und neu angelegte BLOCKING-Einträge bleiben mit älteren Workern lesbar;
-- SLOWDOWN-Einträge müssen vor einem Worker-Rollback beendet oder aus einer Sicherung
-- wiederhergestellt werden.
ALTER TABLE planned_operational_constraints
  ADD COLUMN effect_mode TEXT NOT NULL DEFAULT 'BLOCKING'
  CHECK (effect_mode IN ('BLOCKING', 'SLOWDOWN'));

ALTER TABLE planned_operational_constraints
  ADD COLUMN duration_multiplier_percent INTEGER
  CHECK (
    duration_multiplier_percent IS NULL
    OR duration_multiplier_percent BETWEEN 110 AND 300
  );

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
